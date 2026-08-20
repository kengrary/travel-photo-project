import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
app.use(express.json())

app.get('/api/health', (req, res) => res.json({ ok: true }))

const distDir = path.resolve(__dirname, '../dist')
app.use(express.static(distDir))
app.get('*', (req, res) => res.sendFile(path.join(distDir, 'index.html')))

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`Server on http://localhost:${PORT}`))
