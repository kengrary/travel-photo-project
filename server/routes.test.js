import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import request from 'supertest'
import express from 'express'
import { openDb, insertPhoto } from './db.js'
import { loadGeoIndex } from './geocode.js'
import { photosRouter } from './routes/photos.js'

let app
let db
before(() => {
  db = openDb(':memory:')
  const geo = loadGeoIndex()
  app = express()
  app.use(express.json())
  app.use('/api/photos', photosRouter(db, geo))
})

test('POST /api/photos/:id/location with no existing photo errors gracefully', async () => {
  const res = await request(app).post('/api/photos/999/location').send({ lat: 23.1, lng: 113.2 })
  assert.equal(res.status, 404)
})

test('POST /api/photos with no files field returns 400 JSON (does not hang)', async () => {
  const res = await request(app).post('/api/photos').send({})
  assert.equal(res.status, 400)
  assert.equal(res.body.error, 'No photos uploaded')
})

test('POST /api/photos with empty files field returns 400 JSON', async () => {
  const res = await request(app).post('/api/photos').field('photos', '').attach('photos', Buffer.alloc(0), { filename: '', contentType: 'image/jpeg' })
  assert.equal(res.status, 400)
  assert.equal(res.body.error, 'No photos uploaded')
})

test('POST /api/photos with oversized file returns 400 JSON (multer LIMIT_FILE_SIZE)', async () => {
  const big = Buffer.alloc(30 * 1024 * 1024 + 1)
  const res = await request(app).post('/api/photos').attach('photos', big, { filename: 'big.jpg', contentType: 'image/jpeg' })
  assert.equal(res.status, 400)
  assert.equal(res.body.error, 'File too large')
})

test('DELETE /api/photos/:id with no existing photo returns 404', async () => {
  const res = await request(app).delete('/api/photos/999')
  assert.equal(res.status, 404)
})

test('PATCH /api/photos/:id with no existing photo returns 404', async () => {
  const res = await request(app).patch('/api/photos/999').send({ province: '广东省' })
  assert.equal(res.status, 404)
})

test('POST /api/photos/:id/rotate with no existing photo returns 404', async () => {
  const res = await request(app).post('/api/photos/999/rotate').send({ degrees: 90 })
  assert.equal(res.status, 404)
})

// ---- 搜索与时间筛选 ----
before(() => {
  insertPhoto(db, { filename: 'a.jpg', original_name: 'beach-sun.jpg', province: '浙江省', city: '杭州市', taken_at: '2025-01-10T08:00:00.000Z', created_at: '2025-01-11T00:00:00.000Z' })
  insertPhoto(db, { filename: 'b.jpg', original_name: 'mountain.jpg', province: '广东省', city: '深圳市', taken_at: '2025-03-02T08:00:00.000Z', created_at: '2025-03-03T00:00:00.000Z' })
})

test('GET /api/photos?q= 支持按文件名搜索', async () => {
  const res = await request(app).get('/api/photos?q=beach')
  assert.equal(res.status, 200)
  assert.equal(res.body.photos.length, 1)
  assert.equal(res.body.photos[0].original_name, 'beach-sun.jpg')
})

test('GET /api/photos?q= 支持按地点搜索', async () => {
  const res = await request(app).get('/api/photos?q=' + encodeURIComponent('浙江'))
  assert.equal(res.status, 200)
  assert.equal(res.body.photos.length, 1)
  assert.equal(res.body.photos[0].province, '浙江省')
})

test('GET /api/photos?from=&to= 支持时间段过滤（含边界日）', async () => {
  const res = await request(app).get('/api/photos?from=2025-01-01&to=2025-01-31')
  assert.equal(res.status, 200)
  assert.equal(res.body.photos.length, 1)
  assert.equal(res.body.photos[0].original_name, 'beach-sun.jpg')
})

test('GET /api/photos 无匹配条件时仍返回全部（现有行为不回归）', async () => {
  const res = await request(app).get('/api/photos')
  assert.equal(res.status, 200)
  assert.equal(res.body.photos.length, 2)
})

// ---- 分页 ----
test('GET /api/photos?limit= 返回分页结果与 total', async () => {
  const res = await request(app).get('/api/photos?limit=1')
  assert.equal(res.status, 200)
  assert.equal(res.body.photos.length, 1)
  assert.equal(res.body.total, 2)
})

test('GET /api/photos?offset= 翻页按时间倒序推进', async () => {
  const [r1, r2] = await Promise.all([
    request(app).get('/api/photos?limit=1&offset=0'),
    request(app).get('/api/photos?limit=1&offset=1'),
  ])
  assert.equal(r1.body.photos[0].original_name, 'mountain.jpg') // 2025-03 较新在前
  assert.equal(r2.body.photos[0].original_name, 'beach-sun.jpg')
})

test('GET /api/photos 分页与筛选条件可组合', async () => {
  const res = await request(app).get('/api/photos?q=' + encodeURIComponent('浙江') + '&limit=10&offset=0')
  assert.equal(res.status, 200)
  assert.equal(res.body.photos.length, 1)
  assert.equal(res.body.total, 1)
})

test('GET /api/photos 不带 limit 时保持旧行为（无 total 字段要求）', async () => {
  const res = await request(app).get('/api/photos')
  assert.equal(res.status, 200)
  assert.ok(Array.isArray(res.body.photos))
})
