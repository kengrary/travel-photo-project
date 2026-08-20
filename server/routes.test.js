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
  assert.equal(res.status, 200)
})

test('GET /api/photos/locations returns array', async () => {
  const res = await request(app).get('/api/photos/locations')
  assert.equal(res.status, 200)
  assert.ok(Array.isArray(res.body.locations))
})
