import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import request from 'supertest'
import express from 'express'
import { openDb } from './db.js'
import { loadGeoIndex } from './geocode.js'
import { photosRouter } from './routes/photos.js'
import { writeAuthGuard } from './auth.js'

let app
before(async () => {
  process.env.ACCESS_TOKEN = 'test-secret'
  const db = openDb(':memory:')
  const geo = loadGeoIndex()
  app = express()
  app.use(express.json())
  app.use('/api/photos', writeAuthGuard)
  app.use('/api/photos', photosRouter(db, geo))
})

after(() => { delete process.env.ACCESS_TOKEN })

test('未带令牌的 GET 不受限制（只保护写操作）', async () => {
  const res = await request(app).get('/api/photos')
  assert.equal(res.status, 200)
})

test('未带令牌的 DELETE 返回 401', async () => {
  const res = await request(app).delete('/api/photos/999')
  assert.equal(res.status, 401)
  assert.equal(res.body.error, 'Unauthorized')
})

test('错误令牌的 POST 返回 401', async () => {
  const res = await request(app).post('/api/photos').set('x-access-token', 'wrong')
  assert.equal(res.status, 401)
})

test('正确令牌的 DELETE 放行（进入路由后因照片不存在返回 404）', async () => {
  const res = await request(app).delete('/api/photos/999').set('x-access-token', 'test-secret')
  assert.equal(res.status, 404)
})
