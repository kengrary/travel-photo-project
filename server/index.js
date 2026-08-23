import express from 'express'
import path from 'node:path'
import fs from 'node:fs'
import { exec } from 'node:child_process'
import { openDb } from './db.js'
import { loadGeoIndex, reverseGeocode } from './geocode.js'
import { photosRouter } from './routes/photos.js'
import { importRouter } from './routes/import.js'
import { writeAuthGuard } from './auth.js'
import { GEO_DIR, UPLOAD_DIR, DIST_DIR, BASE_DIR, PORTABLE_MODE } from './paths.js'

const app = express()
app.use(express.json())

const db = openDb()

const geoFile = path.join(GEO_DIR, '100000_full.json')
if (!fs.existsSync(geoFile)) {
  // 首次启动（打包态 data/ 为空）：自动下载边界数据
  console.log('首次启动：下载中国边界数据到 ' + GEO_DIR + ' ...')
  const { downloadBoundaryData } = await import('./scripts/bootstrap-geo.js')
  await downloadBoundaryData()
}
const geo = loadGeoIndex()

app.use('/uploads', express.static(UPLOAD_DIR))
app.use('/data', express.static(GEO_DIR))
// 地图字形切片（bootstrap:geo 下载到 public/fonts；生产态直接由后端提供，无需重新构建）
app.use('/fonts', express.static(path.join(BASE_DIR, 'public', 'fonts')))
// 写操作鉴权（设置 ACCESS_TOKEN 环境变量后启用）
app.use('/api/photos', writeAuthGuard)
app.use('/api/photos', photosRouter(db, geo))
// 批量导入：扫描为只读但暴露文件系统信息，导入为写操作，统一纳入鉴权
app.use('/api/import', writeAuthGuard)
app.use('/api/import', importRouter(db, geo))

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

const distDir = DIST_DIR
app.use(express.static(distDir))
app.get('*', (req, res) => res.sendFile(path.join(distDir, 'index.html')))

const PORT = Number(process.env.PORT) || 3000
const HOST = process.env.HOST || '0.0.0.0'

// 打包态（exe 双击 / 便携包启动脚本）自动打开浏览器；NO_OPEN=1 可禁用
function openBrowser(url) {
  let command
  if (process.platform === 'win32') command = `start "" "${url}"`
  else if (process.platform === 'darwin') command = `open "${url}"`
  else command = `xdg-open "${url}"`
  exec(command, () => {})
}

// 打包态端口被占时自动 +1 重试，避免双击启动因冲突无反应
function listen(port, attemptsLeft) {
  const server = app.listen(port, HOST, () => {
    const displayHost = HOST === '0.0.0.0' ? 'localhost' : HOST
    const url = `http://${displayHost}:${port}`
    console.log(`Server on ${url}`)
    if (PORTABLE_MODE && !process.env.NO_OPEN) openBrowser(url)
  })
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && PORTABLE_MODE && attemptsLeft > 0) {
      console.warn(`端口 ${port} 被占用，改用 ${port + 1}`)
      listen(port + 1, attemptsLeft - 1)
    } else {
      console.error('服务启动失败:', err.message)
      process.exit(1)
    }
  })
}
listen(PORT, PORTABLE_MODE ? 10 : 0)
