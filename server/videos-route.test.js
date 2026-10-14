import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import request from 'supertest'
import express from 'express'
import { openDb } from './db.js'
import { videosRouter, photoMediaPath } from './routes/videos.js'

const app = express()
app.use(express.json())
app.use('/api/videos', videosRouter(openDb(':memory:')))

test('GET /api/videos/music 返回数组', async () => {
  const res = await request(app).get('/api/videos/music')
  assert.equal(res.status, 200)
  assert.ok(Array.isArray(res.body.music))
})

test('GET /api/videos 返回数组', async () => {
  const res = await request(app).get('/api/videos')
  assert.equal(res.status, 200)
  assert.ok(Array.isArray(res.body.videos))
})

test('POST /api/videos/render 缺 fileNames 返回 400', async () => {
  const res = await request(app).post('/api/videos/render').send({ placeName: '大理' })
  assert.equal(res.status, 400)
})

test('POST /api/videos/render 传入不存在的 BGM 返回 400', async () => {
  const res = await request(app).post('/api/videos/render').send({ fileNames: ['x.jpg'], bgm: '../../etc/passwd' })
  assert.equal(res.status, 400)
  // 必须命中 BGM 校验（而非"素材在库中不存在"），否则无法区分路径校验是否失效
  assert.match(res.body.error, /BGM/)
})

test('DELETE /api/videos/:name 不存在返回 404', async () => {
  const res = await request(app).delete('/api/videos/nope.mp4')
  assert.equal(res.status, 404)
})

test('GET /api/videos/:name 不存在返回 404', async () => {
  const res = await request(app).get('/api/videos/nope.mp4')
  assert.equal(res.status, 404)
})

test('photoMediaPath 原图缺失时回退到 full 大图', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vasset-'))
  fs.writeFileSync(path.join(dir, 'full-x.jpg'), 'x')
  const row = { filename: 'missing.jpg', full_path: 'full-x.jpg' }
  assert.equal(photoMediaPath(row, dir), path.join(dir, 'full-x.jpg'))
  fs.rmSync(dir, { recursive: true, force: true })
})

test('photoMediaPath 原图存在时用原图', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vasset-'))
  fs.writeFileSync(path.join(dir, 'orig.jpg'), 'x')
  fs.writeFileSync(path.join(dir, 'full-orig.jpg'), 'x')
  const row = { filename: 'orig.jpg', full_path: 'full-orig.jpg' }
  assert.equal(photoMediaPath(row, dir), path.join(dir, 'orig.jpg'))
  fs.rmSync(dir, { recursive: true, force: true })
})
