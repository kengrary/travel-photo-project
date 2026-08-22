import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import request from 'supertest'
import express from 'express'
import ffmpegPath from 'ffmpeg-static'
import { openDb } from '../db.js'
import { loadGeoIndex } from '../geocode.js'
import { uploadDir } from '../upload.js'
import { importRouter } from './import.js'

const execFileAsync = promisify(execFile)
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'import-routes-'))
const created = [] // uploads/ 下产物清理

let app
before(async () => {
  const db = openDb(':memory:')
  const geo = loadGeoIndex()
  app = express()
  app.use(express.json())
  app.use('/api/import', importRouter(db, geo))
  // fixture：1 张图 + 1 个视频 + 1 个非媒体文件
  await execFileAsync(ffmpegPath, ['-y', '-f', 'lavfi', '-i', 'testsrc=size=320x240', '-frames:v', '1', path.join(tmpDir, 'a.jpg')])
  fs.mkdirSync(path.join(tmpDir, 'sub'), { recursive: true })
  await execFileAsync(ffmpegPath, ['-y', '-f', 'lavfi', '-i', 'testsrc=duration=0.4:size=320x240:rate=10', '-pix_fmt', 'yuv420p', path.join(tmpDir, 'sub', 'c.mp4')])
  fs.writeFileSync(path.join(tmpDir, 'note.txt'), 'skip me')
})

after(() => {
  for (const p of created) { try { fs.unlinkSync(p) } catch {} }
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

function waitForJob(app, jobId, timeoutMs = 30000) {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const poll = async () => {
      try {
        const res = await request(app).get(`/api/import/jobs/${jobId}`)
        if (res.body.status === 'done') return resolve(res.body)
        if (res.body.status === 'error') return reject(new Error(res.body.error))
        if (Date.now() - start > timeoutMs) return reject(new Error('等待任务超时'))
        setTimeout(poll, 100)
      } catch (e) { reject(e) }
    }
    poll()
  })
}

test('POST /scan 缺少 path 返回 400', async () => {
  const res = await request(app).post('/api/import/scan').send({})
  assert.equal(res.status, 400)
})

test('POST /scan 目录不存在返回 400', async () => {
  const res = await request(app).post('/api/import/scan').send({ path: '/definitely/not/exist' })
  assert.equal(res.status, 400)
})

test('扫描→统计→选择→导入 全流程', async () => {
  // 1. 扫描
  const scanRes = await request(app).post('/api/import/scan').send({ path: tmpDir })
  assert.equal(scanRes.status, 200)
  const done = await waitForJob(app, scanRes.body.jobId)

  // 2. 统计与明细
  assert.equal(done.summary.fresh, 2)
  assert.equal(done.summary.duplicates, 0)
  assert.equal(done.summary.photos, 1)
  assert.equal(done.summary.videos, 1)
  assert.equal(done.items.length, 2)
  const mp4 = done.items.find((it) => it.fileName === 'c.mp4')
  assert.equal(mp4.mediaType, 'video')

  // 3. 只选图片导入
  const jpg = done.items.find((it) => it.fileName === 'a.jpg')
  const startRes = await request(app).post('/api/import/start').send({
    jobId: scanRes.body.jobId,
    originPaths: [jpg.filePath],
  })
  assert.equal(startRes.status, 200)
  const imp = await waitForJob(app, startRes.body.jobId)
  assert.equal(imp.result.ok, 1)
  assert.ok(imp.result.failures.every((f) => !f), JSON.stringify(imp.result))

  // 4. 再扫同目录：a.jpg 标记重复，未导入的 c.mp4 不标记
  const rescan = await request(app).post('/api/import/scan').send({ path: tmpDir })
  const done2 = await waitForJob(app, rescan.body.jobId)
  assert.equal(done2.summary.duplicates, 1)
  assert.equal(done2.summary.fresh, 1)
})

test('start 引用未完成的扫描任务返回 400', async () => {
  const res = await request(app).post('/api/import/start').send({ jobId: 'nope', originPaths: ['/x'] })
  assert.equal(res.status, 400)
})

test('start 未选择文件返回 400', async () => {
  const scanRes = await request(app).post('/api/import/scan').send({ path: tmpDir })
  await waitForJob(app, scanRes.body.jobId)
  const res = await request(app).post('/api/import/start').send({ jobId: scanRes.body.jobId, originPaths: [] })
  assert.equal(res.status, 400)
})

test('GET 不存在的任务返回 404', async () => {
  const res = await request(app).get('/api/import/jobs/none')
  assert.equal(res.status, 404)
})
