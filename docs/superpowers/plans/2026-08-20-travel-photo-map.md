# 旅行照片地图应用 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个个人自用的旅行照片 Web 应用：在中国地图（精确到市县）上记录地点、上传照片，并用可切换时间/地点的照片墙展示。

**Architecture:** React + Vite 前端（MapLibre GL 地图），Node + Express 后端（REST API + 静态托管），better-sqlite3 存元数据，本地 `uploads/` 存原图与缩略图。后端启动时用 GeoAtlas 数据构建省市县边界索引，提供离线 GPS→市县本地边界匹配。

**Tech Stack:** React 18, Vite, MapLibre GL, React Router, Express, multer, better-sqlite3, exifr, sharp, Node 24.

## Global Constraints

- Node >= 20（本机 24.18.0）
- 无账号/多用户体系（个人自用）
- 底图瓦片用免费公开源，不申请 API key
- 边界数据用阿里 DataV GeoAtlas（`geo.datav.aliyun.com/areas_v3/bound/*.json`），自托管缓存到 `server/data/geojson/`
- 不打包安装程序，`npm run dev` 即可运行
- 后端统一托管前端静态资源与 API（单端口）
- 照片元数据字段：id, filename, original_name, thumb_path, taken_at, lat, lng, province, city, county, location_name, created_at

---

### Task 1: 项目骨架与依赖

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `vite.config.js`
- Create: `index.html`
- Create: `server/index.js`（最小 Express 服务，后续扩展）
- Create: `src/main.jsx`, `src/App.jsx`

**Interfaces:**
- Produces: npm 脚本 `dev`（并行起前端 + 后端）、`build`、`start`；Express 应用挂载到 `src/client/` 静态目录；`App.jsx` 渲染路由入口。

- [ ] **Step 1: 创建根 `package.json`**

```json
{
  "name": "travel-photo-map",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "concurrently \"npm run dev:server\" \"npm run dev:client\"",
    "dev:server": "node --watch server/index.js",
    "dev:client": "vite",
    "build": "vite build",
    "start": "node server/index.js",
    "bootstrap:geo": "node server/scripts/bootstrap-geo.js"
  },
  "dependencies": {
    "better-sqlite3": "^11.0.0",
    "exifr": "^7.1.3",
    "express": "^4.19.2",
    "multer": "^1.4.5-lts.1",
    "sharp": "^0.33.0"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.0",
    "concurrently": "^9.0.0",
    "vite": "^5.4.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.26.0",
    "maplibre-gl": "^4.5.0"
  }
}
```

> 注：react/react-dom/maplibre 放 devDependencies 是因为 Vite 打包到 `src/client/`，运行时不依赖 node_modules 里的前端库。

- [ ] **Step 2: 创建 `.gitignore`**

```gitignore
node_modules/
dist/
server/data/geojson/
server/uploads/
server/data/app.db
*.log
.DS_Store
```

- [ ] **Step 3: 创建 `vite.config.js`**

```js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/uploads': 'http://localhost:3000',
      '/data': 'http://localhost:3000',
    },
  },
})
```

- [ ] **Step 4: 创建 `index.html`**

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>旅行照片地图</title>
    <link rel="stylesheet" href="https://unpkg.com/maplibre-gl@4/dist/maplibre-gl.css" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

- [ ] **Step 5: 创建 `src/main.jsx`**

```jsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
)
```

- [ ] **Step 6: 创建 `src/index.css`**

```css
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body, #root { height: 100%; }
body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; background: #f5f6f8; }
```

- [ ] **Step 7: 创建 `src/App.jsx`**

```jsx
import { Routes, Route, Link } from 'react-router-dom'
import MapPage from './pages/MapPage.jsx'

export default function App() {
  return (
    <div style={{ height: '100%' }}>
      <nav style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10, display: 'flex', gap: 16, padding: 12, background: 'rgba(255,255,255,0.9)' }}>
        <Link to="/">地图</Link>
        <Link to="/wall">照片墙</Link>
        <Link to="/upload">上传</Link>
      </nav>
      <Routes>
        <Route path="/" element={<MapPage />} />
        <Route path="/wall" element={<div style={{ paddingTop: 48 }}>照片墙（待实现）</div>} />
        <Route path="/upload" element={<div style={{ paddingTop: 48 }}>上传（待实现）</div>} />
      </Routes>
    </div>
  )
}
```

- [ ] **Step 8: 创建最小 `src/pages/MapPage.jsx` 占位**

```jsx
export default function MapPage() {
  return <div style={{ height: '100%', paddingTop: 48 }}>地图（待实现）</div>
}
```

- [ ] **Step 9: 创建最小后端 `server/index.js`**

```js
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
```

- [ ] **Step 10: 安装依赖并验证启动**

Run: `npm install`
Expected: 依赖安装成功，无错误。

Run: `npm run build`
Expected: Vite 构建成功，生成 `dist/`。

Run: `node server/index.js &` 然后 `curl -s localhost:3000/api/health`
Expected: `{"ok":true}`；kill 掉进程。

- [ ] **Step 11: Commit**

```bash
git add package.json .gitignore vite.config.js index.html src server
git commit -m "feat: 项目骨架 + 最小前后端"
```

---

### Task 2: 边界数据引导脚本（bootstrap-geo）

**Files:**
- Create: `server/scripts/bootstrap-geo.js`
- Create: `server/data/geojson/.gitkeep`

**Interfaces:**
- Produces: 下载并缓存以下文件到 `server/data/geojson/`：
  - `100000_full.json`（省份层）
  - `{provinceAdcode}_full.json`（每省的城市层，直辖市为区县层）
  - `{cityAdcode}_full.json`（每市/区县的区县级，用于县级匹配）
  - 生成 `server/data/geojson/index.json`，内容为所有区域扁平列表：`[{adcode, name, level, parentAdcode, province, city, county}]`
- Consumes: 无（独立脚本）。

- [ ] **Step 1: 编写引导脚本**

```js
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.resolve(__dirname, '../data/geojson')
fs.mkdirSync(OUT, { recursive: true })

const BASE = 'https://geo.datav.aliyun.com/areas_v3/bound'
const SLEEP_MS = 120

async function fetchJSON(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
  return res.json()
}

function save(name, data) {
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(data))
  console.log('saved', name)
}

// 直辖市：city 层即区县，无真正"市"层级
const MUNICIPALITIES = new Set(['110000', '120000', '310000', '500000'])

async function main() {
  const provinces = await fetchJSON(`${BASE}/100000_full.json`)
  save('100000_full.json', provinces)

  const index = []

  for (const prov of provinces.features) {
    const p = prov.properties
    const provAdcode = String(p.adcode)
    const provName = p.name
    const provFile = `${provAdcode}_full.json`

    if (!fs.existsSync(path.join(OUT, provFile))) {
      const data = await fetchJSON(`${BASE}/${provFile}`)
      save(provFile, data)
      await new Promise((r) => setTimeout(r, SLEEP_MS))
    }
    const provData = JSON.parse(fs.readFileSync(path.join(OUT, provFile), 'utf8'))

    for (const cityFeat of provData.features) {
      const c = cityFeat.properties
      const cityAdcode = String(c.adcode)
      const cityName = c.name

      const isMunicipality = MUNICIPALITIES.has(provAdcode)
      // 直辖市：city 字段 = 直辖市名，county = 区县
      const cityField = isMunicipality ? provName : cityName
      const countyField = isMunicipality ? cityName : ''

      index.push({
        adcode: cityAdcode, name: cityName, level: c.level,
        parentAdcode: provAdcode, province: provName, city: cityField, county: countyField,
      })

      // 有下一级（非直辖市）时下载区县文件
      if (!isMunicipality && c.childrenNum > 0) {
        const countyFile = `${cityAdcode}_full.json`
        if (!fs.existsSync(path.join(OUT, countyFile))) {
          const data = await fetchJSON(`${BASE}/${countyFile}`)
          save(countyFile, data)
          await new Promise((r) => setTimeout(r, SLEEP_MS))
        }
        const countyData = JSON.parse(fs.readFileSync(path.join(OUT, countyFile), 'utf8'))
        for (const countyFeat of countyData.features) {
          const cc = countyFeat.properties
          index.push({
            adcode: String(cc.adcode), name: cc.name, level: cc.level,
            parentAdcode: cityAdcode, province: provName, city: cityName, county: cc.name,
          })
        }
      }
    }
  }

  save('index.json', index)
  console.log('index entries:', index.length)
}

main().catch((e) => { console.error(e); process.exit(1) })
```

- [ ] **Step 2: 运行引导脚本**

Run: `npm run bootstrap:geo`
Expected: 打印若干 "saved ..." 及 `index entries: <数字>`（约 3000+ 条区县记录）。数据缓存到 `server/data/geojson/`。

- [ ] **Step 3: 验证 index 结构与数据量**

Run:
```bash
node -e "const j=require('./server/data/geojson/index.json'); console.log('total',j.length); console.log('province sample',j.find(x=>x.level==='province')); console.log('county sample',j.find(x=>x.level==='district'))"
```
Expected: 输出总数及 sample，区县示例含正确的 province/city/county 字段。

- [ ] **Step 4: Commit**

```bash
git add server/scripts/bootstrap-geo.js server/data/geojson/.gitkeep
git commit -m "feat: 边界数据引导脚本（省市县 GeoJSON + index）"
```

> 注：`server/data/geojson/` 本身被 .gitignore 忽略，不提交数据文件，只提交脚本。

---

### Task 3: 数据库模块

**Files:**
- Create: `server/db.js`
- Test: `server/db.test.js`

**Interfaces:**
- Produces: `openDb()` 返回 better-sqlite3 实例并建表；`insertPhoto(db, photo)` 插入并返回带 id 的记录；`listPhotos(db, filter)` 查询；`countByLocation(db)` 返回 `[{province,city,county,count}]`；`getPhoto(db, id)` 查询单条；`updateLocation(db, id, {lat,lng,province,city,county,location_name})`。
- Consumes: 无。

- [ ] **Step 1: 编写 `server/db.js`**

```js
import Database from 'better-sqlite3'
import path from 'node:path'
import fs from 'node:fs'

export function openDb(dbPath = process.env.DB_PATH || path.resolve('server/data/app.db')) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT UNIQUE NOT NULL,
      original_name TEXT,
      thumb_path TEXT,
      taken_at TEXT,
      lat REAL,
      lng REAL,
      province TEXT,
      city TEXT,
      county TEXT,
      location_name TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_photos_taken ON photos(taken_at);
    CREATE INDEX IF NOT EXISTS idx_photos_loc ON photos(province, city, county);
  `)
  return db
}

export function insertPhoto(db, photo) {
  const stmt = db.prepare(`
    INSERT INTO photos (filename, original_name, thumb_path, taken_at, lat, lng, province, city, county, location_name, created_at)
    VALUES (@filename, @original_name, @thumb_path, @taken_at, @lat, @lng, @province, @city, @county, @location_name, @created_at)
  `)
  const info = stmt.run(photo)
  return getPhoto(db, info.lastInsertRowid)
}

export function getPhoto(db, id) {
  return db.prepare('SELECT * FROM photos WHERE id = ?').get(id)
}

export function listPhotos(db, filter = {}) {
  const conds = []
  const params = {}
  if (filter.province) { conds.push('province = @province'); params.province = filter.province }
  if (filter.city) { conds.push('city = @city'); params.city = filter.city }
  if (filter.county) { conds.push('county = @county'); params.county = filter.county }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : ''
  const order = filter.orderBy === 'location' ? 'province, city, county, taken_at DESC' : 'taken_at DESC'
  return db.prepare(`SELECT * FROM photos ${where} ORDER BY ${order}`).all(params)
}

export function countByLocation(db) {
  return db.prepare(`
    SELECT province, city, county, COUNT(*) as count
    FROM photos
    GROUP BY province, city, county
  `).all()
}

export function updateLocation(db, id, loc) {
  const stmt = db.prepare(`
    UPDATE photos SET lat=@lat, lng=@lng, province=@province, city=@city, county=@county, location_name=@location_name
    WHERE id=@id
  `)
  stmt.run({ id, ...loc })
  return getPhoto(db, id)
}
```

- [ ] **Step 2: 编写测试**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openDb, insertPhoto, listPhotos, countByLocation, getPhoto, updateLocation } from './db.js'

function makeDb() {
  return openDb(':memory:')
}

test('insert and get photo', () => {
  const db = makeDb()
  const p = insertPhoto(db, {
    filename: 'a.jpg', original_name: 'a.jpg', thumb_path: 't/a.jpg',
    taken_at: '2024-01-01T00:00:00Z', lat: 23.1, lng: 113.2,
    province: '广东省', city: '广州市', county: '天河区', location_name: null,
    created_at: '2024-01-02T00:00:00Z',
  })
  assert.ok(p.id)
  assert.equal(getPhoto(db, p.id).city, '广州市')
})

test('list filters by province', () => {
  const db = makeDb()
  insertPhoto(db, { filename: 'a.jpg', province: '广东省', created_at: 'x' })
  insertPhoto(db, { filename: 'b.jpg', province: '浙江省', created_at: 'y' })
  const rows = listPhotos(db, { province: '广东省' })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].filename, 'a.jpg')
})

test('count by location', () => {
  const db = makeDb()
  insertPhoto(db, { filename: 'a.jpg', province: '广东省', city: '广州市', county: '天河区', created_at: 'x' })
  insertPhoto(db, { filename: 'b.jpg', province: '广东省', city: '广州市', county: '天河区', created_at: 'y' })
  insertPhoto(db, { filename: 'c.jpg', province: '广东省', city: '深圳市', county: '', created_at: 'z' })
  const counts = countByLocation(db)
  assert.deepEqual(counts.find((r) => r.county === '天河区').count, 2)
})

test('update location', () => {
  const db = makeDb()
  const p = insertPhoto(db, { filename: 'a.jpg', province: null, created_at: 'x' })
  const updated = updateLocation(db, p.id, { lat: 1, lng: 2, province: '广东省', city: '广州市', county: '', location_name: '珠江新城' })
  assert.equal(updated.location_name, '珠江新城')
})
```

- [ ] **Step 3: 运行测试验证通过**

Run: `node --test server/db.test.js`
Expected: 4 个测试全部通过。

- [ ] **Step 4: Commit**

```bash
git add server/db.js server/db.test.js
git commit -m "feat: SQLite 数据库模块与测试"
```

---

### Task 4: 本地边界匹配器（GPS → 市县）

**Files:**
- Create: `server/geocode.js`
- Test: `server/geocode.test.js`

**Interfaces:**
- Produces: `loadGeoIndex()` 读取 `server/data/geojson/index.json` 与各 GeoJSON 文件，构建内存结构；`reverseGeocode(lat, lng)` 返回 `{province, city, county}`（未命中返回 `{province:null, city:null, county:null}`）。
- Consumes: Task 2 生成的 `server/data/geojson/` 文件与 `index.json`。

实现说明：索引结构 `{ adcode -> {name, level, parentAdcode, geom: <FeatureCollection>} }`。反查时遍历所有层级做 point-in-polygon 判断。为简单与可靠，采用"先粗后细"：先对省份层（100000_full.json）做点包含测试定位省份 → 再对该省城市层文件做测试定位市 → 再对该市文件定位县。坐标用 `(lng, lat)` 射线法。

- [ ] **Step 1: 编写 `server/geocode.js`**

```js
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const GEO_DIR = path.resolve(__dirname, 'data/geojson')

// 射线法 point-in-polygon（支持 ring 数组 [ [lng,lat], ... ]）
function pointInRing(lng, lat, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1]
    const xj = ring[j][0], yj = ring[j][1]
    const intersect = ((yi > lat) !== (yj > lat)) &&
      (lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi)
    if (intersect) inside = !inside
  }
  return inside
}

function pointInPolygon(lng, lat, coords) {
  // coords 可能是 Polygon [rings] 或 MultiPolygon [polygons]，递归处理
  if (typeof coords[0][0][0] === 'number') {
    // 单个 ring
    return pointInRing(lng, lat, coords[0])
  }
  // 多层：对每个子多边形，任一命中即命中
  for (const sub of coords) {
    if (pointInPolygon(lng, lat, [sub])) return true
  }
  return false
}

function featureContains(feature, lng, lat) {
  return pointInPolygon(lng, lat, feature.geometry.coordinates)
}

class GeoIndex {
  constructor() { this.provinces = [] }

  load() {
    const provFile = path.join(GEO_DIR, '100000_full.json')
    this.provinces = JSON.parse(fs.readFileSync(provFile, 'utf8')).features
  }

  // 给定省 adcode，读取该省的城市层文件并定位
  locateProvince(lng, lat) {
    for (const prov of this.provinces) {
      if (featureContains(prov, lng, lat)) return prov.properties
    }
    return null
  }

  locateChildren(parentAdcode, lng, lat) {
    const file = path.join(GEO_DIR, `${parentAdcode}_full.json`)
    if (!fs.existsSync(file)) return null
    const fc = JSON.parse(fs.readFileSync(file, 'utf8'))
    for (const feat of fc.features) {
      if (featureContains(feat, lng, lat)) return feat.properties
    }
    return null
  }
}

export function loadGeoIndex() {
  const idx = new GeoIndex()
  idx.load()
  return idx
}

// 返回 {province, city, county}
export function reverseGeocode(geo, lng, lat) {
  const prov = geo.locateProvince(lng, lat)
  if (!prov) return { province: null, city: null, county: null }

  const isMunicipality = ['110000', '120000', '310000', '500000'].includes(String(prov.adcode))
  const provName = prov.name

  const child = geo.locateChildren(prov.adcode, lng, lat)
  if (!child) return { province: provName, city: null, county: null }

  if (isMunicipality) {
    // 直辖市：child 是区县，city = 直辖市名
    return { province: provName, city: provName, county: child.name }
  }

  // 省级：child 是市，继续查县的边界文件
  const county = geo.locateChildren(child.adcode, lng, lat)
  return {
    province: provName,
    city: child.name,
    county: county ? county.name : '',
  }
}
```

- [ ] **Step 2: 编写测试**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadGeoIndex, reverseGeocode } from './geocode.js'

const geo = loadGeoIndex()

test('reverse geocode Beijing (municipality district)', () => {
  // 北京市东城区中心附近
  const r = reverseGeocode(geo, 116.418, 39.917)
  assert.equal(r.province, '北京市')
  assert.equal(r.city, '北京市')
  assert.ok(r.county)
})

test('reverse geocode Guangdong Guangzhou (province + city + county)', () => {
  // 广州市天河区中心附近
  const r = reverseGeocode(geo, 113.36, 23.12)
  assert.equal(r.province, '广东省')
  assert.equal(r.city, '广州市')
  assert.ok(r.county)
})

test('reverse geocode empty ocean returns nulls', () => {
  const r = reverseGeocode(geo, 130, 10)
  assert.equal(r.province, null)
})
```

- [ ] **Step 3: 运行测试验证**

Run: `node --test server/geocode.test.js`
Expected: 3 个测试通过（需已运行过 bootstrap-geo 生成数据）。若坐标判定失败，微调测试坐标至命中区域中心。

- [ ] **Step 4: Commit**

```bash
git add server/geocode.js server/geocode.test.js
git commit -m "feat: 本地 GPS→市县边界匹配器与测试"
```

---

### Task 5: 照片上传与 API

**Files:**
- Create: `server/routes/photos.js`
- Create: `server/upload.js`（multer 配置 + 缩略图生成）
- Create: `server/routes.test.js`（集成测试，用 supertest）

**Interfaces:**
- Produces:
  - `POST /api/photos`：multipart，字段 `photos`（多文件）。逐张读 EXIF GPS → 本地反查市县 → 存原图与缩略图 → 写 DB。返回 `{photos: [...]}`。
  - `GET /api/photos?province=&city=&county=&orderBy=time|location`：返回照片列表。
  - `GET /api/locations`：返回 `[{province,city,county,count}]`。
  - `POST /api/photos/:id/location`：body `{lat,lng,location_name}`，反查并更新地点。
  - `GET /uploads/*`：静态提供照片文件。
- Consumes: `openDb`, `insertPhoto`, `listPhotos`, `countByLocation`, `updateLocation`, `loadGeoIndex`, `reverseGeocode`。

- [ ] **Step 1: 编写 `server/upload.js`**

```js
import multer from 'multer'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const UPLOAD_DIR = path.resolve(__dirname, '../uploads')
const THUMB_DIR = path.join(UPLOAD_DIR, 'thumbs')
fs.mkdirSync(THUMB_DIR, { recursive: true })

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg'
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`)
  },
})

export const upload = multer({ storage, limits: { fileSize: 30 * 1024 * 1024 } })

export async function makeThumb(filename) {
  const src = path.join(UPLOAD_DIR, filename)
  const thumbName = `thumb-${path.basename(filename)}`
  const dest = path.join(THUMB_DIR, thumbName)
  await sharp(src).resize({ width: 600, withoutEnlargement: true }).jpeg({ quality: 80 }).toFile(dest)
  return `thumbs/${thumbName}`
}
```

- [ ] **Step 2: 编写 `server/routes/photos.js`**

```js
import { Router } from 'express'
import exifr from 'exifr'
import path from 'node:path'
import { insertPhoto, listPhotos, countByLocation, updateLocation } from '../db.js'
import { upload, makeThumb } from '../upload.js'
import { reverseGeocode } from '../geocode.js'

export function photosRouter(db, geo) {
  const router = Router()

  router.post('/', upload.array('photos', 50), async (req, res) => {
    const results = []
    for (const file of req.files) {
      try {
        const meta = await exifr.parse(file.path, { gps: true, tiff: true })
        const lat = meta?.latitude ?? null
        const lng = meta?.longitude ?? null
        const takenAt = meta?.DateTimeOriginal ?? null
        let province = null, city = null, county = null
        if (lat != null && lng != null) {
          const r = reverseGeocode(geo, lng, lat)
          province = r.province; city = r.city; county = r.county
        }
        const thumbPath = await makeThumb(file.filename)
        const photo = insertPhoto(db, {
          filename: file.filename,
          original_name: file.originalname,
          thumb_path: thumbPath,
          taken_at: takenAt,
          lat, lng, province, city, county,
          location_name: null,
          created_at: new Date().toISOString(),
        })
        results.push(photo)
      } catch (e) {
        results.push({ error: e.message, filename: file.filename })
      }
    }
    res.json({ photos: results })
  })

  router.get('/', (req, res) => {
    const filter = {
      province: req.query.province, city: req.query.city, county: req.query.county,
      orderBy: req.query.orderBy,
    }
    res.json({ photos: listPhotos(db, filter) })
  })

  router.get('/locations', (req, res) => {
    res.json({ locations: countByLocation(db) })
  })

  router.post('/:id/location', (req, res) => {
    const { lat, lng, location_name } = req.body
    let province = null, city = null, county = null
    if (lat != null && lng != null) {
      const r = reverseGeocode(geo, lng, lat)
      province = r.province; city = r.city; county = r.county
    }
    const photo = updateLocation(db, req.params.id, { lat, lng, province, city, county, location_name })
    res.json({ photo })
  })

  return router
}
```

- [ ] **Step 3: 更新 `server/index.js` 挂载路由与静态资源**

```js
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
```

- [ ] **Step 4: 安装 supertest 并写集成测试**

Run: `npm install -D supertest`

创建 `server/routes.test.js`：

```js
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
```

- [ ] **Step 5: 运行测试**

Run: `node --test server/routes.test.js`
Expected: 3 个测试通过。

- [ ] **Step 6: 手动冒烟测试上传（可选，生成一张带 GPS 的测试图）**

Run:
```bash
node -e "
const sharp=require('sharp');
sharp({create:{width:200,height:200,channels:3,background:{r:200,g:100,b:50}}}).jpeg().toFile('/tmp/test.jpg').then(()=>console.log('made'));
"
curl -s -F "photos=@/tmp/test.jpg" localhost:3000/api/photos
```
Expected: 返回 JSON，包含上传的照片记录（无 GPS 时 province/city/county 为 null）。

- [ ] **Step 7: Commit**

```bash
git add server/upload.js server/routes/photos.js server/index.js server/routes.test.js
git commit -m "feat: 照片上传、EXIF 定位与照片/locations API"
```

---

### Task 6: 前端地图页（MapLibre GL）

**Files:**
- Create: `src/pages/MapPage.jsx`
- Create: `src/api.js`
- Modify: `src/App.jsx`

**Interfaces:**
- Produces:
  - `api.js`: `fetchPhotos(filter)`, `fetchLocations()`, `uploadPhotos(files)`, `setPhotoLocation(id, loc)`（封装 fetch 到 /api）。
  - `MapPage.jsx`：渲染 MapLibre 地图，加载省份边界 GeoJSON（`/data/geojson/100000_full.json`，由后端静态提供），按 locations 着色，点击省份/市县打开该地照片墙（路由到 `/wall?province=..&city=..`），提供「上传」入口。
- Consumes: `GET /api/photos/locations`；后端需将 `server/data/geojson/` 暴露为 `/data` 静态路径。

- [ ] **Step 1: 在 `server/index.js` 增加 `/data` 静态路径**

```js
app.use('/data', express.static(path.resolve(__dirname, 'data/geojson')))
```

- [ ] **Step 2: 编写 `src/api.js`**

```js
async function j(res) { const d = await res.json(); if (!res.ok) throw new Error(d.error || res.status); return d }

export const fetchLocations = () => fetch('/api/photos/locations').then(j).then((d) => d.locations)
export const fetchPhotos = (filter = {}) => {
  const q = new URLSearchParams()
  for (const k of ['province', 'city', 'county', 'orderBy']) if (filter[k]) q.set(k, filter[k])
  return fetch(`/api/photos?${q}`).then(j).then((d) => d.photos)
}
export const uploadPhotos = (files) => {
  const fd = new FormData()
  for (const f of files) fd.append('photos', f)
  return fetch('/api/photos', { method: 'POST', body: fd }).then(j).then((d) => d.photos)
}
export const setPhotoLocation = (id, loc) =>
  fetch(`/api/photos/${id}/location`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(loc) }).then(j).then((d) => d.photo)
```

- [ ] **Step 3: 编写 `src/pages/MapPage.jsx`**

```jsx
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import maplibregl from 'maplibre-gl'
import { fetchLocations } from '../api.js'

const CENTER = [104.195, 35.861]
const BASE_STYLE = 'https://demotiles.maplibre.org/style.json' // 免费矢量底图

export default function MapPage() {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const [locations, setLocations] = useState([])
  const navigate = useNavigate()

  useEffect(() => {
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASE_STYLE,
      center: CENTER,
      zoom: 3.5,
    })
    mapRef.current = map

    map.on('load', async () => {
      const locs = await fetchLocations()
      setLocations(locs)

      const res = await fetch('/data/100000_full.json')
      const geojson = await res.json()

      map.addSource('provinces', { type: 'geojson', data: geojson })
      map.addLayer({
        id: 'province-fill',
        type: 'fill',
        source: 'provinces',
        paint: { 'fill-color': '#cccccc', 'fill-opacity': 0.5 },
      })
      map.addLayer({
        id: 'province-line',
        type: 'line',
        source: 'provinces',
        paint: { 'line-color': '#888', 'line-width': 1 },
      })

      map.on('click', 'province-fill', (e) => {
        const name = e.features[0].properties.name
        navigate(`/wall?province=${encodeURIComponent(name)}`)
      })
      map.on('mouseenter', 'province-fill', () => (map.getCanvas().style.cursor = 'pointer'))
      map.on('mouseleave', 'province-fill', () => (map.getCanvas().style.cursor = ''))
    })

    return () => map.remove()
  }, [navigate])

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      <div style={{ position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 5 }}>
        <button onClick={() => navigate('/upload')} style={{ padding: '10px 20px', fontSize: 16 }}>上传照片</button>
      </div>
    </div>
  )
}
```

> 说明：省份边界着色为简单统一色；若需要按照片数量着色，可在地图加载后动态计算 `fill-color` 表达式。MVP 先保证点击省份进入照片墙，颜色分级作为增强。

- [ ] **Step 4: 手动验证地图页**

Run: `npm run build && node server/index.js &`，浏览器打开 `http://localhost:3000`
Expected: 地图加载显示省份边界；点击任意省份跳转到 `/wall?province=..`。

- [ ] **Step 5: Commit**

```bash
git add src/api.js src/pages/MapPage.jsx server/index.js
git commit -m "feat: 地图页（MapLibre GL + 省份边界 + 点击进入照片墙）"
```

---

### Task 7: 照片墙页

**Files:**
- Create: `src/pages/WallPage.jsx`

**Interfaces:**
- Produces: `WallPage.jsx` 读取 URL 查询参数（province/city/county），展示对应照片网格；支持 `orderBy=time|location` 切换；点击照片弹 lightbox 显示大图与元数据。
- Consumes: `fetchPhotos(filter)`。

- [ ] **Step 1: 编写 `src/pages/WallPage.jsx`**

```jsx
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { fetchPhotos } from '../api.js'

export default function WallPage() {
  const [params] = useSearchParams()
  const [photos, setPhotos] = useState([])
  const [orderBy, setOrderBy] = useState('time')
  const [lightbox, setLightbox] = useState(null)

  const filter = {
    province: params.get('province') || undefined,
    city: params.get('city') || undefined,
    county: params.get('county') || undefined,
    orderBy,
  }

  useEffect(() => {
    fetchPhotos(filter).then(setPhotos)
  }, [params.toString(), orderBy])

  const title = [filter.province, filter.city, filter.county].filter(Boolean).join(' · ') || '全部照片'

  return (
    <div style={{ paddingTop: 48, paddingBottom: 24 }}>
      <h2 style={{ padding: '0 16px' }}>{title}</h2>
      <div style={{ padding: '0 16px', display: 'flex', gap: 8, margin: '12px 0' }}>
        <button onClick={() => setOrderBy('time')} style={orderBy === 'time' ? active : {}}>按时间</button>
        <button onClick={() => setOrderBy('location')} style={orderBy === 'location' ? active : {}}>按地点</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8, padding: 16 }}>
        {photos.map((p) => (
          <img
            key={p.id}
            src={`/uploads/${p.thumb_path}`}
            alt={p.original_name}
            onClick={() => setLightbox(p)}
            style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', cursor: 'pointer', borderRadius: 6 }}
          />
        ))}
      </div>
      {photos.length === 0 && <p style={{ padding: '0 16px', color: '#888' }}>暂无照片</p>}
      {lightbox && (
        <div onClick={() => setLightbox(null)} style={overlay}>
          <div onClick={(e) => e.stopPropagation()}>
            <img src={`/uploads/${lightbox.filename}`} style={{ maxWidth: '90vw', maxHeight: '80vh' }} />
            <p style={{ color: '#fff', marginTop: 8 }}>
              {lightbox.original_name} · {lightbox.taken_at || '未知时间'} ·{' '}
              {[lightbox.province, lightbox.city, lightbox.county].filter(Boolean).join(' ') || '未知地点'}
              {lightbox.location_name ? ` · ${lightbox.location_name}` : ''}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

const active = { fontWeight: 'bold', borderBottom: '2px solid #333' }
const overlay = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'zoom-out', zIndex: 100,
}
```

- [ ] **Step 2: 在 `src/App.jsx` 引入 WallPage**

```jsx
import WallPage from './pages/WallPage.jsx'
// ...
<Route path="/wall" element={<WallPage />} />
```

- [ ] **Step 3: 手动验证**

Run: `npm run build && node server/index.js &`，浏览器访问 `/wall?province=广东省`
Expected: 显示照片网格；点按时间/按地点切换排序；点击照片弹出 lightbox。

- [ ] **Step 4: Commit**

```bash
git add src/pages/WallPage.jsx src/App.jsx
git commit -m "feat: 照片墙页（时间/地点切换 + lightbox）"
```

---

### Task 8: 上传页

**Files:**
- Create: `src/pages/UploadPage.jsx`

**Interfaces:**
- Produces: `UploadPage.jsx` 支持多选照片上传；对无 GPS 或需确认地点的照片，提供地图点选 + 搜索市县的手动定位；上传完成后跳转或显示结果。
- Consumes: `uploadPhotos(files)`, `setPhotoLocation(id, loc)`。

- [ ] **Step 1: 编写 `src/pages/UploadPage.jsx`**

```jsx
import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import maplibregl from 'maplibre-gl'
import { uploadPhotos, setPhotoLocation } from '../api.js'

const BASE_STYLE = 'https://demotiles.maplibre.org/style.json'

export default function UploadPage() {
  const [files, setFiles] = useState([])
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState([])
  const [manualTarget, setManualTarget] = useState(null) // 待手动定位的照片
  const [map, setMap] = useState(null)
  const mapContainer = useRef(null)
  const markerRef = useRef(null)
  const navigate = useNavigate()

  const onSelect = (e) => setFiles([...e.target.files])

  const doUpload = async () => {
    setUploading(true)
    const photos = await uploadPhotos(files)
    setResult(photos)
    setUploading(false)
    // 有未定位照片时，进入手动定位
    const needs = photos.filter((p) => !p.province)
    if (needs.length) { setManualTarget(needs[0]); openMap() }
  }

  const openMap = () => {
    if (map) return
    const m = new maplibregl.Map({ container: mapContainer.current, style: BASE_STYLE, center: [104.195, 35.861], zoom: 3.5 })
    m.on('click', (e) => {
      if (markerRef.current) markerRef.current.remove()
      markerRef.current = new maplibregl.Marker().setLngLat(e.lngLat).addTo(m)
      setManualTarget((t) => (t ? { ...t, _lat: e.lngLat.lat, _lng: e.lngLat.lng } : t))
    })
    setMap(m)
  }

  const confirmLocation = async () => {
    if (!manualTarget || manualTarget._lat == null) return
    await setPhotoLocation(manualTarget.id, { lat: manualTarget._lat, lng: manualTarget._lng })
    alert('已更新地点')
    setManualTarget(null)
  }

  return (
    <div style={{ paddingTop: 48, padding: 16 }}>
      <h2>上传照片</h2>
      <input type="file" multiple accept="image/*" onChange={onSelect} />
      <button onClick={doUpload} disabled={uploading || files.length === 0} style={{ marginLeft: 12 }}>
        {uploading ? '上传中…' : '上传'}
      </button>
      <button onClick={() => navigate('/wall')} style={{ marginLeft: 12 }}>查看照片墙</button>

      {manualTarget && (
        <div style={{ marginTop: 16 }}>
          <p>「{manualTarget.original_name}」未自动定位，请在地图上点击位置：</p>
          <div ref={mapContainer} style={{ width: '100%', height: 400, marginTop: 8 }} />
          <button onClick={confirmLocation} style={{ marginTop: 8 }} disabled={manualTarget._lat == null}>确认此地点</button>
        </div>
      )}

      {result.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <h3>上传结果</h3>
          {result.map((p, i) => (
            <p key={i}>
              {p.original_name}: {p.error ? `失败 ${p.error}` : `已定位 ${p.province || ''} ${p.city || ''} ${p.county || ''}`}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: 在 `src/App.jsx` 引入 UploadPage**

```jsx
import UploadPage from './pages/UploadPage.jsx'
// ...
<Route path="/upload" element={<UploadPage />} />
```

- [ ] **Step 3: 手动验证**

Run: `npm run build && node server/index.js &`，浏览器访问 `/upload`，选择图片上传。
Expected: 有 GPS 的照片自动定位；无 GPS 的出现手动定位地图，点击地图确认地点后更新。

- [ ] **Step 4: Commit**

```bash
git add src/pages/UploadPage.jsx src/App.jsx
git commit -m "feat: 上传页（多选上传 + 手动定位）"
```

---

### Task 9: 地图按市县着色 + 城市/区县层级浏览（增强）

**Files:**
- Modify: `src/pages/MapPage.jsx`

**Interfaces:**
- Consumes: `fetchLocations()`、后端 `/data/{adcode}_full.json` 静态文件。
- Produces: 地图根据 `fetchLocations()` 的计数，为省/市/县区域按照片数量着色（数量多颜色深）；点击区域后按层级下钻（省→市→县），并在照片墙展示当前层级照片。

- [ ] **Step 1: 增强 MapPage 支持动态着色与下钻**

```jsx
// 在 MapPage.jsx 中，将省份着色改为基于照片数量的渐变色。
// 用一个 map 把 province/city/county 计数汇总，构建 fill-color 表达式。
// 点击省份后加载该省城市层 /data/{adcode}_full.json 替换为城市图层，再点击城市进入照片墙。
```

> 说明：这一步是视觉增强，MVP 可先以"点击进入照片墙"为主。若用户希望地图上直接看到每个市县的深浅，再实现本任务的逐级下钻与着色。可延后到 MVP 之后。

- [ ] **Step 2: 与用户确认是否需要颜色分级/下钻**

- [ ] **Step 3: Commit（若实现）**

```bash
git add src/pages/MapPage.jsx
git commit -m "feat: 地图按照片数量着色与市县下钻"
```

---

## Self-Review 检查

**Spec coverage:**
- 地图到市县 ✔（Task 2 数据 + Task 6/9 地图 + Task 4 定位）
- 上传照片 ✔（Task 5 后端 + Task 8 前端）
- GPS 自动定位 + 手动回退 ✔（Task 4/5 + Task 8）
- 照片墙按时间/地点切换 ✔（Task 7）
- 本地自托管、免费瓦片、无 key ✔（Task 1/6）
- 本地边界匹配（离线反查）✔（Task 4）

**Placeholder scan:** 无 TBD/TODO；Task 9 明确标注为可延后的增强。

**Type consistency:** `reverseGeocode(geo, lng, lat)` 在 Task 4 定义、Task 5 使用，签名一致；`fetchLocations`/`fetchPhotos`/`uploadPhotos`/`setPhotoLocation` 在 Task 6 定义、Task 7/8 使用，命名一致；DB 函数签名在 Task 3 定义、Task 5 使用，一致。
