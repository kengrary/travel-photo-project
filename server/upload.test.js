import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import ffmpegPath from 'ffmpeg-static'
import { makeVideoAssets, uploadDir } from './upload.js'

const execFileAsync = promisify(execFile)
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-test-'))
const created = [] // 记录 makeVideoAssets 产物，测试后清理

function assetPaths(videoName) {
  const base = path.basename(videoName)
  return [
    path.join(uploadDir, videoName),
    path.join(uploadDir, 'thumbs', `thumb-${base}.jpg`),
    path.join(uploadDir, 'full', `full-${base}.jpg`),
  ]
}

async function genClip(dest, duration) {
  await execFileAsync(ffmpegPath, [
    '-y', '-f', 'lavfi', '-i', `testsrc=duration=${duration}:size=320x240:rate=10`,
    '-pix_fmt', 'yuv420p', dest,
  ])
}

before(async () => {
  await genClip(path.join(tmpDir, 'short.mp4'), 0.4)
  await genClip(path.join(tmpDir, 'normal.mp4'), 3)
})

after(() => {
  for (const p of created) { try { fs.unlinkSync(p) } catch {} }
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

test('makeVideoAssets 为正常时长视频生成海报帧', async () => {
  const r = await makeVideoAssets(`t-normal-${Date.now()}.mp4`, path.join(tmpDir, 'normal.mp4'))
  created.push(...assetPaths(r.video))
  assert.ok(fs.existsSync(path.join(uploadDir, r.thumb)), '缩略图应存在')
  assert.ok(fs.existsSync(path.join(uploadDir, r.full)), '大图应存在')
})

test('makeVideoAssets 对不足 1 秒的视频仍能生成有效海报帧', async () => {
  const r = await makeVideoAssets(`t-short-${Date.now()}.mp4`, path.join(tmpDir, 'short.mp4'))
  created.push(...assetPaths(r.video))
  for (const p of [r.thumb, r.full]) {
    const full = path.join(uploadDir, p)
    assert.ok(fs.existsSync(full), `${p} 应存在`)
    assert.ok(fs.statSync(full).size > 1000, `${p} 应是有效的 JPEG（>1KB）`)
  }
})
