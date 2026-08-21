import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import request from 'supertest'
import express from 'express'
import { openDb } from './db.js'
import { loadGeoIndex } from './geocode.js'
import { photosRouter } from './routes/photos.js'

let app
before(() => {
  const db = openDb(':memory:')
  const geo = loadGeoIndex()
  app = express()
  app.use(express.json())
  app.use('/api/photos', photosRouter(db, geo))
})

test('GET /api/photos returns empty list', async () => {
  const res = await request(app).get('/api/photos')
  assert.equal(res.status, 200)
  assert.deepEqual(res.body.photos, [])
})

test('POST /api/photos/:id/location with no existing photo errors gracefully', async () => {
  const res = await request(app).post('/api/photos/999/location').send({ lat: 23.1, lng: 113.2 })
  assert.equal(res.status, 404)
})

test('GET /api/photos/locations returns array', async () => {
  const res = await request(app).get('/api/photos/locations')
  assert.equal(res.status, 200)
  assert.ok(Array.isArray(res.body.locations))
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
