import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDb } from './db.js'
import { loadGeoIndex } from './geocode.js'
import { photosRouter } from './routes/photos.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
app.use(express.json())

const db = openDb()
const geo = loadGeoIndex()

app.use('/uploads', express.static(path.resolve(__dirname, '../uploads')))
app.use('/api/photos', photosRouter(db, geo))

const distDir = path.resolve(__dirname, '../dist')
app.use(express.static(distDir))
app.get('*', (req, res) => res.sendFile(path.join(distDir, 'index.html')))

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`Server on http://localhost:${PORT}`))
