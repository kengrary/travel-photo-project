import express from 'express'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { openDb } from './db.js'
import { loadGeoIndex } from './geocode.js'
import { photosRouter } from './routes/photos.js'

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
app.use('/api/photos', photosRouter(db, geo))

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }))

const distDir = path.resolve(__dirname, '../dist')
app.use(express.static(distDir))
app.get('*', (req, res) => res.sendFile(path.join(distDir, 'index.html')))

const PORT = process.env.PORT || 3000
const HOST = process.env.HOST || '0.0.0.0'
app.listen(PORT, HOST, () => console.log(`Server on http://${HOST}:${PORT}`))
