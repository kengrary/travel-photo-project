import express from 'express'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { openDb } from './db.js'
import { loadGeoIndex, reverseGeocode } from './geocode.js'
import { photosRouter } from './routes/photos.js'
import { writeAuthGuard } from './auth.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
app.use(express.json())

const db = openDb()

const geoFile = path.resolve(__dirname, 'data/geojson/100000_full.json')
if (!fs.existsSync(geoFile)) {
  console.error('边界数据未初始化，请先运行 npm run bootstrap:geo')
  process.exit(1)
}
const geo = loadGeoIndex()

app.use('/uploads', express.static(path.resolve(__dirname, '../uploads')))
app.use('/data', express.static(path.resolve(__dirname, 'data/geojson')))
// 写操作鉴权（设置 ACCESS_TOKEN 环境变量后启用）
app.use('/api/photos', writeAuthGuard)
app.use('/api/photos', photosRouter(db, geo))

// 逆地理编码：根据经纬度反查省市县
app.get('/api/geocode/reverse', (req, res) => {
  const lat = Number(req.query.lat)
  const lng = Number(req.query.lng)
  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    return res.status(400).json({ error: 'Invalid lat/lng' })
  }
  const r = reverseGeocode(geo, lng, lat)
  res.json({ province: r.province, city: r.city, county: r.county })
})

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }))

const distDir = path.resolve(__dirname, '../dist')
app.use(express.static(distDir))
app.get('*', (req, res) => res.sendFile(path.join(distDir, 'index.html')))

const PORT = process.env.PORT || 3000
const HOST = process.env.HOST || '0.0.0.0'
app.listen(PORT, HOST, () => console.log(`Server on http://${HOST}:${PORT}`))
