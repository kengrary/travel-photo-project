import { test } from 'node:test'
import assert from 'node:assert/strict'
import request from 'supertest'
import express from 'express'
import { openDb } from './db.js'
import { videosRouter } from './routes/videos.js'

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
})

test('DELETE /api/videos/:name 不存在返回 404', async () => {
  const res = await request(app).delete('/api/videos/nope.mp4')
  assert.equal(res.status, 404)
})

test('GET /api/videos/:name 不存在返回 404', async () => {
  const res = await request(app).get('/api/videos/nope.mp4')
  assert.equal(res.status, 404)
})
