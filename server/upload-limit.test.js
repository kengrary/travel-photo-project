// 上传大小上限：UPLOAD_MAX_MB 可配置（默认 500MB），超限返回中文提示
process.env.UPLOAD_MAX_MB = '1'

const { test, before } = await import('node:test')
const assert = (await import('node:assert/strict')).default
const { default: request } = await import('supertest')
const { default: express } = await import('express')

const { openDb } = await import('./db.js')
const { loadGeoIndex } = await import('./geocode.js')
const { photosRouter } = await import('./routes/photos.js')

let app
before(() => {
  const db = openDb(':memory:')
  const geo = loadGeoIndex()
  app = express()
  app.use('/api/photos', photosRouter(db, geo))
})

test('超过 UPLOAD_MAX_MB 的文件返回中文提示', async () => {
  const big = Buffer.alloc(1 * 1024 * 1024 + 1)
  const res = await request(app).post('/api/photos').attach('photos', big, { filename: 'big.jpg', contentType: 'image/jpeg' })
  assert.equal(res.status, 400)
  assert.match(res.body.error, /超过 1MB 上限/)
})
