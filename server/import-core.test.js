import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import ffmpegPath from 'ffmpeg-static'
import { openDb } from './db.js'
import { loadGeoIndex } from './geocode.js'
import { uploadDir } from './upload.js'
import { collectMediaFiles, readMediaMeta, prepareItem, commitItem } from './import-core.js'

const execFileAsync = promisify(execFile)
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'import-core-'))
const created = [] // uploads/ 下产生的文件，结束后清理

let db, geo

async function genImage(dest) {
  await execFileAsync(ffmpegPath, ['-y', '-f', 'lavfi', '-i', 'testsrc=size=320x240', '-frames:v', '1', dest])
}
async function genClip(dest, dur) {
  await execFileAsync(ffmpegPath, ['-y', '-f', 'lavfi', '-i', `testsrc=duration=${dur}:size=320x240:rate=10`, '-pix_fmt', 'yuv420p', dest])
}

before(async () => {
  db = openDb(':memory:')
  geo = loadGeoIndex()
  fs.mkdirSync(path.join(tmpDir, 'sub'), { recursive: true })
  await genImage(path.join(tmpDir, 'a.jpg'))
  await genImage(path.join(tmpDir, 'b.png'))
  await genClip(path.join(tmpDir, 'sub', 'c.mp4'), 0.5)
  fs.writeFileSync(path.join(tmpDir, 'note.txt'), 'not media')
})

after(() => {
  for (const p of created) { try { fs.unlinkSync(p) } catch {} }
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

test('collectMediaFiles 递归收集图片视频、忽略其他扩展名', () => {
  const files = collectMediaFiles(tmpDir)
  const names = files.map((f) => path.relative(tmpDir, f)).sort()
  assert.deepEqual(names, ['a.jpg', 'b.png', 'sub/c.mp4'])
})

test('readMediaMeta 对无 EXIF 图片返回空定位与时间', async () => {
  const m = await readMediaMeta(path.join(tmpDir, 'a.jpg'))
  assert.equal(m.mediaType, 'photo')
  assert.equal(m.lat, null)
  assert.equal(m.lng, null)
  assert.equal(m.takenAt, null)
})

test('readMediaMeta 对视频返回类型与时长', async () => {
  const m = await readMediaMeta(path.join(tmpDir, 'sub', 'c.mp4'))
  assert.equal(m.mediaType, 'video')
  assert.ok(m.duration > 0.3 && m.duration < 0.8, `duration=${m.duration}`)
})

test('prepareItem + commitItem 完成入库且按 origin_path 幂等', async () => {
  const src = path.join(tmpDir, 'a.jpg')
  const item = await prepareItem(db, geo, src)
  assert.ok(item, '首扫应产出条目')
  assert.equal(item.mediaType, 'photo')
  assert.equal(item.province, null) // 无 GPS → 无位置

  const photo = await commitItem(db, item, {})
  assert.ok(photo.id)
  assert.equal(photo.origin_path, src)
  assert.equal(photo.media_type, 'photo')
  for (const rel of [photo.thumb_path, photo.full_path]) {
    const p = path.join(uploadDir, rel)
    assert.ok(fs.existsSync(p), `${rel} 应存在`)
    created.push(p)
  }
  created.push(path.join(uploadDir, photo.filename))

  // 同一来源再次准备 → 判定为重复，返回 null
  const again = await prepareItem(db, geo, src)
  assert.equal(again, null)
})
