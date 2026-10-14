# 旅行照片成片（A+C 本地成片）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在地图按地点一键把该处的照片与视频合成为一段旅行视频（成片），全本地、离线，支持 16:9 与 9:16、BGM、ASS 中文字幕、非 AI 择优。

**Architecture:** 地图地点面板 → 素材筛选/参数对话框 → 后台内存 job → 两阶段 ffmpeg 渲染（逐素材归一化片段 → xfade 拼接 + ass 字幕 + amix 混音）→ `exports/` 目录 +「我的成片」页。择优抽成 provider 接口（默认 sharp 启发式）。

**Tech Stack:** Node ESM、Express、better-sqlite3、sharp、ffmpeg/ffprobe（ffmpeg-static 与系统 ~/bin/ffmpeg 双候选）、React 18 + Vite、supercluster/MapLibre。

## Global Constraints

- ESM 项目（`"type": "module"`），全部用 `import`/`export`。
- 全中文注释与提交信息；提交前缀 `feat:` / `fix:` / `style:` / `docs:`。
- 测试命令：`npm test`（= `node --test server/*.test.js`，**只匹配 server/ 顶层**）。新增测试必须放 `server/` 顶层。
- 边界数据：`npm run bootstrap:geo` 必须先跑过（`routes.test.js`/`import.test.js` 依赖）。
- 不新增 npm 依赖（复用 sharp / ffmpeg-static / ffprobe-static / supertest）。
- 写操作鉴权沿用 `x-access-token`（`server/auth.js` 的 `writeAuthGuard`）。
- 字幕统一走 ASS/libass；字体只用系统字体，`VIDEO_FONT` 可覆盖，默认 Linux `Noto Sans CJK SC` / Windows `Microsoft YaHei`。
- 渲染优先 NVENC，失败或不可用回退 CPU libx264；质量 CRF/CQ 默认 20，可用 `VIDEO_CRF` 覆盖。
- 成片只写 `EXPORTS_DIR`，**不写入照片库**。

---

## File Structure

- Modify `server/paths.js` — 新增 `EXPORTS_DIR` / `MUSIC_DIR`。
- Modify `server/upload.js` — 导出 `resolveFfmpeg` / `resolveFfprobe`，新增 `hasAudioStream`。
- Create `server/analyze.js` — 启发式择优/剔废（dHash 去重、清晰度、曝光、打分）。
- Create `server/video-render.js` — 时间线规划、ASS 生成、ffmpeg 参数构造、两阶段编排。
- Create `server/routes/videos.js` — 内存 job 的成片路由。
- Modify `server/index.js` — 挂载 `/api/videos`。
- Modify `server/db.js` — 新增 `listPhotosByFilenames(db, names)`。
- Modify `src/api.js` — 成片相关 API 封装。
- Create `src/components/VideoDialog.jsx` — 素材筛选 + 参数 + 进度 + 预览。
- Modify `src/components/PhotoPanel.jsx` — 加"生成旅行视频"按钮。
- Modify `src/pages/MapPage.jsx` — 承载 `VideoDialog`。
- Create `src/pages/VideosPage.jsx` — 「我的成片」列表。
- Modify `src/App.jsx` — 路由与导航。
- Modify `src/app.css` — 对话框与成片页样式。
- Modify `AGENTS.md` — 字体与成片说明。
- Tests: `server/analyze.test.js`、`server/video-render.test.js`、`server/videos-route.test.js`。

---

### Task 1: 路径与 ffmpeg/ffprobe 工具导出

**Files:**
- Modify: `server/paths.js`
- Modify: `server/upload.js`
- Test: `server/paths.test.js`

**Interfaces:**
- Produces:
  - `EXPORTS_DIR: string`（`EXPORTS_DIR` env → `BASE_DIR/exports`）
  - `MUSIC_DIR: string`（`MUSIC_DIR` env → `DATA_DIR/music`）
  - `resolveFfmpeg(): Promise<{ path: string, gpu: boolean }>`
  - `resolveFfprobe(): Promise<string>`
  - `hasAudioStream(srcPath: string): Promise<boolean>`

- [ ] **Step 1: 写失败测试（paths）**

在 `server/paths.test.js` 的"开发态"用例里追加断言：

```js
  assert.equal(p.EXPORTS_DIR, path.join(ROOT, 'exports'))
  assert.equal(p.MUSIC_DIR, path.join(ROOT, 'server', 'data', 'music'))
```

并在"打包态"用例里追加：

```js
    assert.equal(p.EXPORTS_DIR, path.resolve('/fake/dir/exports'))
    assert.equal(p.MUSIC_DIR, path.resolve('/fake/dir/data/music'))
```

- [ ] **Step 2: 运行验证失败**

Run: `node --test server/paths.test.js`
Expected: FAIL（`EXPORTS_DIR`/`MUSIC_DIR` 为 undefined）

- [ ] **Step 3: 实现 paths.js**

在 `server/paths.js` 末尾追加：

```js
export const EXPORTS_DIR = path.resolve(process.env.EXPORTS_DIR || path.join(BASE_DIR, 'exports'))
export const MUSIC_DIR = path.resolve(process.env.MUSIC_DIR || path.join(DATA_DIR, 'music'))
```

- [ ] **Step 4: 运行验证通过**

Run: `node --test server/paths.test.js`
Expected: PASS（4 个用例全绿）

- [ ] **Step 5: 导出 ffmpeg/ffprobe 解析 + hasAudioStream**

在 `server/upload.js` 中把两处函数声明加 `export`：

```js
export async function resolveFfmpeg() {
```
```js
export async function resolveFfprobe() {
```

在同文件 `probeVideo` 之后追加：

```js
// 判断视频是否含音频流（决定合成时是否需要补静音轨）
const audioCache = new Map()
export async function hasAudioStream(srcPath) {
  if (audioCache.has(srcPath)) return audioCache.get(srcPath)
  const { stdout } = await execFileAsync(await resolveFfprobe(), [
    '-v', 'quiet', '-print_format', 'json', '-show_streams', '-select_streams', 'a', srcPath,
  ])
  const has = (JSON.parse(stdout).streams || []).length > 0
  audioCache.set(srcPath, has)
  return has
}
```

- [ ] **Step 6: 运行全量测试确认无回归**

Run: `npm test`
Expected: 原有用例仍全绿（依赖已 bootstrap:geo 的用例通过）。

- [ ] **Step 7: 提交**

```bash
git add server/paths.js server/paths.test.js server/upload.js
git commit -m "feat: 成片基座——新增 EXPORTS_DIR/MUSIC_DIR 路径与 ffmpeg/ffprobe 解析、音频流探测导出"
```

---

### Task 2: 启发式择优 `analyze.js`

**Files:**
- Create: `server/analyze.js`
- Test: `server/analyze.test.js`

**Interfaces:**
- Produces:
  - `toGray(data: Uint8Array|Buffer, width: number, height: number, channels: number): Uint8Array`
  - `dHash(gray: Uint8Array, width: number, height: number): string`（要求 width=9、height=8，返回 16 位十六进制串）
  - `hammingDistance(a: string, b: string): number`
  - `laplacianVariance(gray: Uint8Array, width: number, height: number): number`
  - `exposureRatio(gray: Uint8Array): number`（过曝+欠曝像素占比 0..1）
  - `scoreMetrics({ sharpness, exposure, width, height }): number`（0..1）
  - `analyzeAssets(items: Array<{ id, filename, imagePath }>): Promise<Array<{ id, filename, width, height, sharpness, exposure, phash, score }>>`
- Consumes: 无（仅 sharp 与 node 内置）

- [ ] **Step 1: 写失败测试**

创建 `server/analyze.test.js`：

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import sharp from 'sharp'
import { toGray, dHash, hammingDistance, laplacianVariance, exposureRatio, analyzeAssets } from './analyze.js'

test('toGray 单通道原样返回，多通道按亮度加权', () => {
  assert.deepEqual([...toGray(new Uint8Array([10, 20, 30]), 1, 1, 3)], [26])
})

test('dHash 相同图像距离为 0', () => {
  const g = new Uint8Array(9 * 8)
  for (let i = 0; i < g.length; i++) g[i] = (i % 9) * 28
  const h = dHash(g, 9, 8)
  assert.equal(h.length, 16)
  assert.equal(hammingDistance(h, h), 0)
})

test('dHash 对反转梯度产生非零距离', () => {
  const a = new Uint8Array(9 * 8)
  const b = new Uint8Array(9 * 8)
  for (let i = 0; i < a.length; i++) { a[i] = (i % 9) * 28; b[i] = (8 - (i % 9)) * 28 }
  assert.ok(hammingDistance(dHash(a, 9, 8), dHash(b, 9, 8)) > 0)
})

test('laplacianVariance 平坦图接近 0，棋盘图显著更大', () => {
  const flat = new Uint8Array(8 * 8).fill(128)
  const checker = new Uint8Array(8 * 8)
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) checker[y * 8 + x] = (x + y) % 2 ? 0 : 255
  assert.ok(laplacianVariance(flat, 8, 8) < 1)
  assert.ok(laplacianVariance(checker, 8, 8) > laplacianVariance(flat, 8, 8))
})

test('exposureRatio 全黑为 1，中灰为 0', () => {
  assert.equal(exposureRatio(new Uint8Array(16).fill(0)), 1)
  assert.equal(exposureRatio(new Uint8Array(16).fill(128)), 0)
})

test('analyzeAssets 返回评分字段且 0..1', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'analyze-'))
  const p = path.join(dir, 'x.jpg')
  await sharp({ create: { width: 60, height: 40, channels: 3, background: { r: 120, g: 120, b: 120 } } }).jpeg().toFile(p)
  const r = await analyzeAssets([{ id: 1, filename: 'x.jpg', imagePath: p }])
  assert.equal(r.length, 1)
  assert.ok(r[0].score >= 0 && r[0].score <= 1)
  assert.equal(r[0].phash.length, 16)
  fs.rmSync(dir, { recursive: true, force: true })
})
```

- [ ] **Step 2: 运行验证失败**

Run: `node --test server/analyze.test.js`
Expected: FAIL（找不到 `./analyze.js`）

- [ ] **Step 3: 实现 analyze.js**

创建 `server/analyze.js`：

```js
// 启发式择优：完全不依赖模型/联网，用 sharp 读取像素做基础质量打分。
// 该模块是"分析 provider 接口"的默认实现；将来接云端/本地 VLM 时替换 analyzeAssets 即可，
// 上层 video-render 只消费 { id, filename, score, phash, ... } 这些字段。
import sharp from 'sharp'

// 单通道灰度：已是单通道直接返回；多通道按 ITU-R BT.601 亮度加权
export function toGray(data, width, height, channels) {
  if (channels === 1) return Uint8Array.from(data)
  const out = new Uint8Array(width * height)
  for (let i = 0; i < out.length; i++) {
    const o = i * channels
    out[i] = Math.round(0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2])
  }
  return out
}

// 差异哈希：9x8 灰度相邻列比较，得 64 位（16 位十六进制）
export function dHash(gray, width, height) {
  let bits = 0n
  let n = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width - 1; x++) {
      if (gray[y * width + x] > gray[y * width + x + 1]) bits |= 1n << BigInt(n)
      n++
    }
  }
  return bits.toString(16).padStart(16, '0')
}

// 汉明距离：两个十六进制哈希的按位差异数
export function hammingDistance(a, b) {
  let x = BigInt('0x' + a) ^ BigInt('0x' + b)
  let c = 0
  while (x > 0n) { c += Number(x & 1n); x >>= 1n }
  return c
}

// 拉普拉斯方差：清晰度指标（越大越锐利）
export function laplacianVariance(gray, width, height) {
  const vals = []
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x
      const lap = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - width] - gray[i + width]
      vals.push(lap)
    }
  }
  if (vals.length === 0) return 0
  const mean = vals.reduce((s, v) => s + v, 0) / vals.length
  return vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length
}

// 曝光异常比例：亮度 <=5 或 >=250 的像素占比
export function exposureRatio(gray) {
  let bad = 0
  for (const g of gray) if (g <= 5 || g >= 250) bad++
  return gray.length ? bad / gray.length : 0
}

// 把三项指标折成 0..1 综合分
export function scoreMetrics({ sharpness, exposure, width, height }) {
  const sharpScore = Math.min(1, sharpness / 400)          // 经验阈值，400 以上视为足够锐
  const exposureScore = 1 - Math.min(1, exposure / 0.15)   // 异常像素 15% 以上视为过曝/欠曝严重
  const resScore = Math.min(1, (width * height) / (1920 * 1080))
  return Math.round((sharpScore * 0.5 + exposureScore * 0.3 + resScore * 0.2) * 1000) / 1000
}

// 读取一批素材图片，产出每张的指标与评分；单张失败跳过
export async function analyzeAssets(items) {
  const out = []
  for (const it of items) {
    try {
      const img = sharp(it.imagePath)
      const meta = await img.metadata()
      const small = await sharp(it.imagePath).resize(9, 8, { fit: 'fill' }).grayscale().raw().toBuffer()
      const full = await sharp(it.imagePath).resize(320, null, { withoutEnlargement: true }).grayscale().raw().toBuffer({ resolveWithObject: true })
      const sharpness = laplacianVariance(full.data, full.info.width, full.info.height)
      const gray = toGray(full.data, full.info.width, full.info.height, full.info.channels)
      const exposure = exposureRatio(gray)
      const width = meta.width || full.info.width
      const height = meta.height || full.info.height
      out.push({
        id: it.id, filename: it.filename,
        width, height, sharpness, exposure,
        phash: dHash(small, 9, 8),
        score: scoreMetrics({ sharpness, exposure, width, height }),
      })
    } catch {
      // 单张分析失败：给中位分兜底，不阻断整体
      out.push({ id: it.id, filename: it.filename, width: 0, height: 0, sharpness: 0, exposure: 0, phash: '0000000000000000', score: 0.5 })
    }
  }
  return out
}
```

- [ ] **Step 4: 运行验证通过**

Run: `node --test server/analyze.test.js`
Expected: PASS（6 个用例全绿）

- [ ] **Step 5: 提交**

```bash
git add server/analyze.js server/analyze.test.js
git commit -m "feat: 启发式择优 analyze——清晰度/曝光/去重打分(provider 接口默认实现)"
```

---

### Task 3: 时间线规划与 ASS 生成（纯函数）

**Files:**
- Create: `server/video-render.js`（本任务先写常量、`planTimeline`、`buildAss`）
- Test: `server/video-render.test.js`

**Interfaces:**
- Produces:
  - `FPS = 30`、`TRANSITION = 0.5`、`PER_PHOTO = 3`、`MAX_VIDEO_CLIP = 5`
  - `ASPECTS = { '16:9': { w: 1920, h: 1080 }, '9:16': { w: 1080, h: 1920 } }`
  - `LENGTHS = { short: 30, medium: 60, long: 120 }`
  - `planTimeline(assets, opts): Array<{ id, filename, mediaType, duration, takenAt }>`
  - `buildAss({ placeName, firstDate, lastDate, count, width, height, font, introDur }): string`
- Consumes: 无

- [ ] **Step 1: 写失败测试**

创建 `server/video-render.test.js`：

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planTimeline, buildAss, ASPECTS } from './video-render.js'

const photo = (id, day, score = 0.8) => ({ id, filename: `p${id}.jpg`, mediaType: 'photo', takenAt: `2024-06-${day}`, score })
const video = (id, day, dur, score = 0.8) => ({ id, filename: `v${id}.mp4`, mediaType: 'video', takenAt: `2024-06-${day}`, duration: dur, score })

test('planTimeline 按拍摄时间升序', () => {
  const r = planTimeline([photo(2, '20'), photo(1, '10')], { targetSeconds: 60 })
  assert.deepEqual(r.map((s) => s.id), [1, 2])
})

test('planTimeline 照片每段 3s、视频片段最多 5s', () => {
  const r = planTimeline([photo(1, '10'), video(2, '11', 9)], { targetSeconds: 60 })
  assert.equal(r[0].duration, 3)
  assert.equal(r[1].duration, 5)
})

test('planTimeline 超出预算时裁掉低分素材', () => {
  const many = Array.from({ length: 40 }, (_, i) => photo(i + 1, '10', i === 5 ? 0.1 : 0.9))
  const r = planTimeline(many, { targetSeconds: 30 })
  assert.ok(r.length < 40)
  assert.ok(!r.some((s) => s.id === 6), '最低分应被裁掉')
})

test('planTimeline 至少保留一个素材', () => {
  const r = planTimeline([photo(1, '10')], { targetSeconds: 1 })
  assert.equal(r.length, 1)
})

test('buildAss 含字体名、地点名与画布尺寸', () => {
  const ass = buildAss({
    placeName: '大理', firstDate: '2024-06-01', lastDate: '2024-06-20', count: 12,
    width: ASPECTS['16:9'].w, height: ASPECTS['16:9'].h, font: 'Noto Sans CJK SC', introDur: 4,
  })
  assert.match(ass, /PlayResX: 1920/)
  assert.match(ass, /PlayResY: 1080/)
  assert.match(ass, /Noto Sans CJK SC/)
  assert.match(ass, /大理/)
  assert.match(ass, /Dialogue:/)
})
```

- [ ] **Step 2: 运行验证失败**

Run: `node --test server/video-render.test.js`
Expected: FAIL（找不到 `./video-render.js`）

- [ ] **Step 3: 实现常量 + planTimeline + buildAss**

创建 `server/video-render.js`：

```js
// 旅行成片渲染：时间线规划（纯函数）+ ASS 字幕（纯函数）+ 两阶段 ffmpeg 编排。
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolveFfmpeg, hasAudioStream } from './upload.js'
import { analyzeAssets } from './analyze.js'
import { EXPORTS_DIR, MUSIC_DIR, UPLOAD_DIR } from './paths.js'

const execFileAsync = promisify(execFile)

export const FPS = 30
export const TRANSITION = 0.5       // 转场时长（秒）
export const PER_PHOTO = 3          // 每张照片时长（秒）
export const MAX_VIDEO_CLIP = 5     // 每个视频片段最长（秒）

export const ASPECTS = {
  '16:9': { w: 1920, h: 1080 },
  '9:16': { w: 1080, h: 1920 },
}
export const LENGTHS = { short: 30, medium: 60, long: 120 }

fs.mkdirSync(EXPORTS_DIR, { recursive: true })
fs.mkdirSync(MUSIC_DIR, { recursive: true })

// 时间线规划：按拍摄时间升序、照片 3s、视频最多 5s；超预算时反复裁掉最低分素材
// 返回 [{ id, filename, mediaType, duration, takenAt }]
export function planTimeline(assets, { targetSeconds, perPhoto = PER_PHOTO, maxVideoClip = MAX_VIDEO_CLIP, transition = TRANSITION } = {}) {
  const ordered = [...assets].sort((a, b) => String(a.takenAt || '').localeCompare(String(b.takenAt || '')))
  let segs = ordered.map((a) => ({
    id: a.id, filename: a.filename, mediaType: a.mediaType, takenAt: a.takenAt,
    score: a.score ?? 0.5,
    duration: a.mediaType === 'video' ? Math.min(maxVideoClip, a.duration || maxVideoClip) : perPhoto,
  }))
  const total = () => segs.reduce((s, x) => s + x.duration, 0) - transition * Math.max(0, segs.length - 1)
  while (segs.length > 1 && total() > targetSeconds) {
    let worst = 0
    for (let i = 1; i < segs.length; i++) if (segs[i].score < segs[worst].score) worst = i
    segs = segs.filter((_, i) => i !== worst)
  }
  return segs.map(({ score, ...s }) => s)
}

// 转 ASS 时间戳：H:MM:SS.cc
function assTime(sec) {
  const s = Math.max(0, sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = Math.floor(s % 60)
  const cc = Math.round((s - Math.floor(s)) * 100)
  return `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${String(cc).padStart(2, '0')}`
}

// 生成片头大标题 ASS：地点名 + 日期范围 + 张数
export function buildAss({ placeName, firstDate, lastDate, count, width, height, font, introDur = 4 }) {
  const range = firstDate === lastDate ? firstDate : `${firstDate} — ${lastDate}`
  const subtitle = `${range} · ${count} 张`
  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Title,${font},${Math.round(height / 14)},&H00FFFFFF,&H000000FF,&H96000000,&H64000000,-1,0,0,0,100,100,0,0,1,3,1,2,60,60,${Math.round(height / 8)},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,${assTime(0)},${assTime(introDur)},Title,,0,0,0,,${placeName}\\N{\\fs${Math.round(height / 30)}}${subtitle}
`
}
```

- [ ] **Step 4: 运行验证通过**

Run: `node --test server/video-render.test.js`
Expected: PASS（5 个用例全绿）

- [ ] **Step 5: 提交**

```bash
git add server/video-render.js server/video-render.test.js
git commit -m "feat: 成片时间线规划与 ASS 片头字幕生成(纯函数)"
```

---

### Task 4: ffmpeg 参数构造（纯函数）

**Files:**
- Modify: `server/video-render.js`
- Test: `server/video-render.test.js`

**Interfaces:**
- Produces:
  - `buildPhotoArgs({ src, dest, width, height, duration, fps = FPS }): string[]`
  - `buildVideoArgs({ src, dest, width, height, duration, hasAudio, fps = FPS }): string[]`
  - `buildConcatArgs({ clips, dest, assPath, width, height, bgm, bgmVolume, totalDuration, encoder, fps = FPS }): string[]`
- Consumes: `FPS`、`TRANSITION`（同文件）

- [ ] **Step 1: 写失败测试**

在 `server/video-render.test.js` 追加：

```js
import { buildPhotoArgs, buildVideoArgs, buildConcatArgs } from './video-render.js'

test('buildPhotoArgs 用 zoompan 做运镜、补静音轨、限时长', () => {
  const a = buildPhotoArgs({ src: 'p.jpg', dest: 'c.mp4', width: 1920, height: 1080, duration: 3 })
  assert.ok(a.includes('-i') && a.includes('p.jpg'))
  const fc = a[a.indexOf('-filter_complex') + 1]
  assert.match(fc, /zoompan/)
  assert.match(fc, /anullsrc|1:a|0:a|1:v/)
  assert.equal(a[a.indexOf('-t') + 1], '3')
  assert.equal(a[a.length - 1], 'c.mp4')
})

test('buildVideoArgs 有音轨时映射 [a]，无音轨时补 anullsrc', () => {
  const withA = buildVideoArgs({ src: 'v.mp4', dest: 'c.mp4', width: 1080, height: 1920, duration: 4, hasAudio: true })
  assert.ok(withA.includes('[a]'))
  assert.ok(!withA.includes('anullsrc'))
  const noA = buildVideoArgs({ src: 'v.mp4', dest: 'c.mp4', width: 1080, height: 1920, duration: 4, hasAudio: false })
  assert.ok(noA.includes('anullsrc'))
})

test('buildConcatArgs 两段含 xfade/acrossfade，配 BGM 含 amix 与 stream_loop', () => {
  const clips = [{ path: 'a.mp4', duration: 3, hasAudio: true }, { path: 'b.mp4', duration: 3, hasAudio: true }]
  const a = buildConcatArgs({
    clips, dest: 'out.mp4', assPath: 'sub.ass', width: 1920, height: 1080,
    bgm: '/m/song.mp3', bgmVolume: 0.5, totalDuration: 5.5, encoder: { gpu: false, crf: 20 },
  })
  const fc = a.filter((x, i) => a[i - 1] === '-filter_complex')[0]
  assert.match(fc, /xfade/)
  assert.match(fc, /acrossfade/)
  assert.match(fc, /amix/)
  assert.ok(a.includes('-stream_loop'))
  assert.equal(a[a.length - 1], 'out.mp4')
})
```

- [ ] **Step 2: 运行验证失败**

Run: `node --test server/video-render.test.js`
Expected: FAIL（`buildPhotoArgs is not a function` 等）

- [ ] **Step 3: 实现三个参数构造函数**

在 `server/video-render.js` 的 `buildAss` 之后追加：

```js
// 编码器参数：NVENC 用 -cq，CPU 用 -crf
function encodeArgs(encoder) {
  if (encoder.gpu) return ['-c:v', 'h264_nvenc', '-preset', 'p4', '-rc', 'vbr', '-cq', String(encoder.crf), '-b:v', '0']
  return ['-c:v', 'libx264', '-preset', 'medium', '-crf', String(encoder.crf)]
}

// 照片 → 归一化短片：模糊铺底 + 居中适配 + 慢速推近，补静音立体声轨
export function buildPhotoArgs({ src, dest, width, height, duration, fps = FPS }) {
  const frames = Math.max(2, Math.round(duration * fps))
  const fc = [
    `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},gblur=sigma=25[bg]`,
    `[0:v]scale=${width}:${height}:force_original_aspect_ratio=decrease[fg]`,
    `[bg][fg]overlay=(W-w)/2:(H-h)/2,zoompan=z='min(zoom+0.0009,1.2)':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${width}x${height}:fps=${fps},setsar=1,format=yuv420p[v]`,
    `[1:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[a]`,
  ].join(';')
  return [
    '-y', '-i', src, '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
    '-filter_complex', fc, '-map', '[v]', '-map', '[a]',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    '-c:a', 'aac', '-b:a', '128k',
    '-t', String(duration), '-r', String(fps), dest,
  ]
}

// 视频 → 归一化片段：裁剪/缩放至画布，采样率声道统一；无音轨则补静音
export function buildVideoArgs({ src, dest, width, height, duration, hasAudio, fps = FPS }) {
  const vf = `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},fps=${fps},setsar=1,format=yuv420p[v]`
  const args = ['-y', '-i', src]
  let fc
  if (hasAudio) {
    fc = `${vf};[0:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[a]`
  } else {
    args.push('-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo')
    fc = `${vf};[1:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[a]`
  }
  args.push('-filter_complex', fc, '-map', '[v]', '-map', '[a]',
    '-t', String(duration), '-r', String(fps),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', dest)
  return args
}

// 合成：视频 xfade 链 + ass 字幕 + 音频 acrossfade 链 + BGM amix
// assPath 需为相对路径（调用方以临时目录为 cwd 执行，规避 Windows 盘符转义问题）
export function buildConcatArgs({ clips, dest, assPath, width, height, bgm, bgmVolume = 0.5, totalDuration, encoder, fps = FPS }) {
  const n = clips.length
  const inputs = []
  for (const c of clips) inputs.push('-i', c.path)
  let bgmIndex = null
  if (bgm) { inputs.push('-stream_loop', '-1', '-i', bgm); bgmIndex = n }

  const fc = []
  // 视频：逐段 xfade 叠化
  let vprev = '0:v'
  let offset = 0
  for (let i = 1; i < n; i++) {
    offset += clips[i - 1].duration - TRANSITION
    const label = `v${i}`
    fc.push(`[${vprev}][${i}:v]xfade=transition=fade:duration=${TRANSITION}:offset=${offset.toFixed(3)}[${label}]`)
    vprev = label
  }
  let vfinal = n === 1 ? '0:v' : vprev
  if (assPath) {
    fc.push(`[${vfinal}]ass=${assPath}[vout]`)
    vfinal = 'vout'
  }
  // 音频：逐段 acrossfade（与 xfade 重叠一致）
  let aprev = '0:a'
  for (let i = 1; i < n; i++) {
    const label = `a${i}`
    fc.push(`[${aprev}][${i}:a]acrossfade=d=${TRANSITION}:c1=tri:c2=tri[${label}]`)
    aprev = label
  }
  let afinal = n === 1 ? '0:a' : aprev
  if (bgm) {
    fc.push(`[${bgmIndex}:a]volume=${bgmVolume},atrim=0:${(totalDuration).toFixed(3)},asetpts=PTS-STARTPTS[bgm]`)
    fc.push(`[${afinal}][bgm]amix=inputs=2:duration=first:normalize=0[aout]`)
    afinal = 'aout'
  }
  return [
    '-y', ...inputs, '-filter_complex', fc.join(';'),
    '-map', `[${vfinal}]`, '-map', `[${afinal}]`,
    ...encodeArgs(encoder), '-c:a', 'aac', '-b:a', '160k',
    '-movflags', '+faststart', '-r', String(fps), dest,
  ]
}
```

- [ ] **Step 4: 运行验证通过**

Run: `node --test server/video-render.test.js`
Expected: PASS（8 个用例全绿）

- [ ] **Step 5: 提交**

```bash
git add server/video-render.js server/video-render.test.js
git commit -m "feat: 成片 ffmpeg 参数构造——照片运镜片段/视频归一化/xfade+ass+amix 合成(纯函数)"
```

---

### Task 5: `renderVideo` 两阶段编排

**Files:**
- Modify: `server/video-render.js`

**Interfaces:**
- Produces: `renderVideo({ assets, placeName, aspect, bgm, length }, onProgress): Promise<{ name, outputPath }>`
  - `assets: Array<{ id, filename, mediaType, takenAt, duration, mediaPath, imagePath }>`
  - `aspect: '16:9' | '9:16'`、`bgm: string | null`、`length: 'short' | 'medium' | 'long'`
  - `onProgress(phase: string, processed: number, total: number)`
- Consumes: `planTimeline`、`buildAss`、`buildPhotoArgs`、`buildVideoArgs`、`buildConcatArgs`、`analyzeAssets`、`resolveFfmpeg`、`hasAudioStream`

- [ ] **Step 1: 实现 renderVideo（无独立单测，Task 5 末尾用真实素材手测）**

在 `server/video-render.js` 末尾追加：

```js
// 安全文件名：去掉路径分隔与 Windows 非法字符
function safeName(s) {
  return String(s || '旅行').replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 40) || '旅行'
}

// 探测是否有中文字体（Linux 用 fc-list 尽力而为；缺失仅告警，不阻断）
async function warnIfNoCjkFont(font) {
  if (process.platform !== 'linux') return
  try {
    const { stdout } = await execFileAsync('fc-list', [':lang=zh'])
    if (!stdout.trim()) console.warn(`[成片] 未检测到系统中文字体，字幕可能不显示；可执行 sudo apt install fonts-noto-cjk（当前 fontname=${font}）`)
  } catch { /* 无 fc-list 则跳过 */ }
}

// 两阶段渲染：逐素材归一化 → xfade+ass+amix 合成。返回成片文件名与绝对路径
export async function renderVideo({ assets, placeName, aspect, bgm, length }, onProgress = () => {}) {
  const dims = ASPECTS[aspect] || ASPECTS['16:9']
  const targetSeconds = LENGTHS[length] || LENGTHS.medium
  const font = process.env.VIDEO_FONT || (process.platform === 'win32' ? 'Microsoft YaHei' : 'Noto Sans CJK SC')
  const crf = Number(process.env.VIDEO_CRF) || 20
  await warnIfNoCjkFont(font)

  // 择优：先分析再规划
  onProgress('analyze', 0, assets.length)
  const metrics = await analyzeAssets(assets)
  const byId = new Map(metrics.map((m) => [m.id, m]))
  const scored = assets.map((a) => ({ ...a, score: byId.get(a.id)?.score ?? 0.5 }))
  const timeline = planTimeline(scored, { targetSeconds })
  if (timeline.length === 0) throw new Error('没有可用素材')

  const ff = await resolveFfmpeg()
  const encoder = { gpu: ff.gpu, crf }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'travel-video-'))
  try {
    // 阶段一：逐素材归一化为统一的无声/有声片段
    const clips = []
    for (let i = 0; i < timeline.length; i++) {
      const seg = timeline[i]
      const asset = assets.find((a) => a.id === seg.id)
      const dest = path.join(tmp, `clip-${String(i).padStart(3, '0')}.mp4`)
      if (seg.mediaType === 'video') {
        const hasAudio = await hasAudioStream(asset.mediaPath)
        await execFileAsync(ff.path, buildVideoArgs({ src: asset.mediaPath, dest, width: dims.w, height: dims.h, duration: seg.duration, hasAudio }))
        clips.push({ path: dest, duration: seg.duration, hasAudio })
      } else {
        await execFileAsync(ff.path, buildPhotoArgs({ src: asset.mediaPath, dest, width: dims.w, height: dims.h, duration: seg.duration }))
        clips.push({ path: dest, duration: seg.duration, hasAudio: true })
      }
      onProgress('render', i + 1, timeline.length)
    }

    // 阶段二：合成（assPath 用相对路径 + cwd=tmp）
    const dates = timeline.map((s) => String(s.takenAt || '').slice(0, 10)).filter(Boolean).sort()
    const assFile = path.join(tmp, 'sub.ass')
    fs.writeFileSync(assFile, buildAss({
      placeName, firstDate: dates[0] || '', lastDate: dates[dates.length - 1] || '', count: timeline.length,
      width: dims.w, height: dims.h, font, introDur: 4,
    }))
    onProgress('compose', 0, 1)

    const totalDuration = clips.reduce((s, c) => s + c.duration, 0) - TRANSITION * Math.max(0, clips.length - 1)
    const bgmPath = bgm ? path.join(MUSIC_DIR, bgm) : null
    const name = `${safeName(placeName)}-${Date.now()}.mp4`
    const outputPath = path.join(EXPORTS_DIR, name)
    const args = buildConcatArgs({
      clips, dest: outputPath, assPath: 'sub.ass', width: dims.w, height: dims.h,
      bgm: bgmPath, totalDuration, encoder,
    })
    try {
      await execFileAsync(ff.path, args, { cwd: tmp, maxBuffer: 1024 * 1024 * 16 })
    } catch (e) {
      if (!ff.gpu) throw e
      // NVENC 合成失败：回退 CPU 重编码
      const reason = String(e.stderr || '').split('\n').filter((l) => /Error|error|failed/i.test(l)).slice(-2).join(' | ') || e.message
      console.warn(`[成片] NVENC 合成失败，回退 CPU：${reason}`)
      const cpuArgs = buildConcatArgs({
        clips, dest: outputPath, assPath: 'sub.ass', width: dims.w, height: dims.h,
        bgm: bgmPath, totalDuration, encoder: { gpu: false, crf },
      })
      await execFileAsync(ff.path, cpuArgs, { cwd: tmp, maxBuffer: 1024 * 1024 * 16 })
    }
    onProgress('compose', 1, 1)
    return { name, outputPath }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}
```

- [ ] **Step 2: 语法与导入自检**

Run: `node -e "import('./server/video-render.js').then(m => console.log(typeof m.renderVideo, typeof m.planTimeline, typeof m.buildAss))"`
Expected: 输出 `function function function`（无导入错误）

- [ ] **Step 3: 真实素材手测（16:9）**

用一个含地图图标的临时目录构造素材并渲染：

```bash
mkdir -p /tmp/tv && node -e "
import('sharp').then(async ({default:sharp})=>{
  await sharp({create:{width:1200,height:800,channels:3,background:{r:80,g:140,b:200}}}).jpeg().toFile('/tmp/tv/a.jpg');
  await sharp({create:{width:800,height:1200,channels:3,background:{r:200,g:120,b:80}}}).jpeg().toFile('/tmp/tv/b.jpg');
  console.log('ok')
})"
node -e "
import('./server/video-render.js').then(async (m)=>{
  const r = await m.renderVideo({
    assets: [
      { id:1, filename:'a.jpg', mediaType:'photo', takenAt:'2024-06-01', mediaPath:'/tmp/tv/a.jpg', imagePath:'/tmp/tv/a.jpg' },
      { id:2, filename:'b.jpg', mediaType:'photo', takenAt:'2024-06-02', mediaPath:'/tmp/tv/b.jpg', imagePath:'/tmp/tv/b.jpg' },
    ],
    placeName:'测试地点', aspect:'16:9', bgm:null, length:'short',
  }, (p,a,b)=>console.log(p,a+'/'+b));
  console.log('OUT', r.outputPath);
})"
```

Expected: 打印进度并输出 `exports/测试地点-<ts>.mp4`，文件存在且 `ffprobe` 能读出 1920x1080、时长约 5.5s。打开确认有轻推运镜与片头字幕（若系统无中文字体则标题可能不显示，属预期）。

- [ ] **Step 4: 真实素材手测（9:16）**

```bash
node -e "
import('./server/video-render.js').then(async (m)=>{
  const r = await m.renderVideo({
    assets: [
      { id:1, filename:'a.jpg', mediaType:'photo', takenAt:'2024-06-01', mediaPath:'/tmp/tv/a.jpg', imagePath:'/tmp/tv/a.jpg' },
      { id:2, filename:'b.jpg', mediaType:'photo', takenAt:'2024-06-02', mediaPath:'/tmp/tv/b.jpg', imagePath:'/tmp/tv/b.jpg' },
    ],
    placeName:'竖版测试', aspect:'9:16', bgm:null, length:'short',
  });
  console.log('OUT', r.outputPath);
})"
```

Expected: 生成 1080x1920 成片，横图呈"模糊铺底 + 居中"效果。

- [ ] **Step 5: 清理临时产物并提交**

```bash
rm -rf /tmp/tv
rm -f exports/测试地点-*.mp4 exports/竖版测试-*.mp4
git add server/video-render.js
git commit -m "feat: 成片两阶段渲染编排 renderVideo——择优→归一化→xfade/ass/amix，NVENC 失败回退 CPU"
```

---

### Task 6: 成片路由与挂载

**Files:**
- Modify: `server/db.js`
- Create: `server/routes/videos.js`
- Modify: `server/index.js`
- Test: `server/videos-route.test.js`

**Interfaces:**
- Produces:
  - `listPhotosByFilenames(db, names: string[]): object[]`（按传入顺序返回存在的行）
  - `videosRouter(db): express.Router`
- Consumes: `renderVideo`、`EXPORTS_DIR`、`MUSIC_DIR`、`UPLOAD_DIR`、`listPhotosByFilenames`

- [ ] **Step 1: 写失败测试**

创建 `server/videos-route.test.js`：

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import request from 'supertest'
import express from 'express'
import { openDb } from './db.js'
import { videosRouter } from './routes/videos.js'

const app = express()
app.use(express.json())
app.use('/api/videos', videosRouter(openDb(':memory:')))

test('GET /api/videos/music 返回数组', async () => {
  const res = await request(app).get('/api/videos/music')
  assert.equal(res.status, 200)
  assert.ok(Array.isArray(res.body.music))
})

test('GET /api/videos 返回数组', async () => {
  const res = await request(app).get('/api/videos')
  assert.equal(res.status, 200)
  assert.ok(Array.isArray(res.body.videos))
})

test('POST /api/videos/render 缺 fileNames 返回 400', async () => {
  const res = await request(app).post('/api/videos/render').send({ placeName: '大理' })
  assert.equal(res.status, 400)
})

test('DELETE /api/videos/:name 不存在返回 404', async () => {
  const res = await request(app).delete('/api/videos/nope.mp4')
  assert.equal(res.status, 404)
})

test('GET /api/videos/:name 不存在返回 404', async () => {
  const res = await request(app).get('/api/videos/nope.mp4')
  assert.equal(res.status, 404)
})
```

- [ ] **Step 2: 运行验证失败**

Run: `node --test server/videos-route.test.js`
Expected: FAIL（找不到 `./routes/videos.js`）

- [ ] **Step 3: db.js 增加按文件名批量查询**

在 `server/db.js` 末尾追加：

```js
// 按 filename 批量查询（保持传入顺序，缺失的跳过）
export function listPhotosByFilenames(db, names) {
  const stmt = db.prepare('SELECT * FROM photos WHERE filename = ?')
  const out = []
  for (const name of names) {
    const row = stmt.get(name)
    if (row) out.push(row)
  }
  return out
}
```

- [ ] **Step 4: 实现路由**

创建 `server/routes/videos.js`：

```js
// 旅行成片：后台内存 job（单进程自托管；重启失效），同一时刻只允许一个渲染任务。
import { Router } from 'express'
import path from 'node:path'
import fs from 'node:fs'
import { EXPORTS_DIR, MUSIC_DIR, UPLOAD_DIR } from '../paths.js'
import { listPhotosByFilenames } from '../db.js'
import { renderVideo, ASPECTS, LENGTHS } from '../video-render.js'

const AUDIO_EXTS = new Set(['.mp3', '.m4a', '.aac', '.wav', '.flac', '.ogg'])

// 由 DB 行构造渲染素材描述（mediaPath 供 ffmpeg，imagePath 供择优分析）
function toAsset(row) {
  const mediaPath = path.join(UPLOAD_DIR, row.filename)
  const imagePath = row.media_type === 'video'
    ? path.join(UPLOAD_DIR, row.thumb_path || row.filename)
    : path.join(UPLOAD_DIR, row.full_path || row.filename)
  return {
    id: row.id, filename: row.filename, mediaType: row.media_type,
    takenAt: row.taken_at, duration: row.duration, mediaPath, imagePath,
  }
}

export function videosRouter(db) {
  const r = Router()
  const jobs = new Map()
  let running = null

  function newJob() {
    const id = `video-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const job = { id, kind: 'video', status: 'running', phase: '', processed: 0, total: 0, createdAt: Date.now() }
    jobs.set(id, job)
    return job
  }

  // 启动渲染
  r.post('/render', (req, res) => {
    const { fileNames, placeName, aspect, bgm, length } = req.body || {}
    if (!Array.isArray(fileNames) || fileNames.length === 0) return res.status(400).json({ error: '未选择任何素材' })
    if (aspect && !ASPECTS[aspect]) return res.status(400).json({ error: `不支持的画幅: ${aspect}` })
    if (length && !LENGTHS[length]) return res.status(400).json({ error: `不支持的时长档: ${length}` })
    if (running) return res.status(409).json({ error: '已有成片任务进行中', jobId: running })

    const rows = listPhotosByFilenames(db, fileNames)
    if (rows.length === 0) return res.status(400).json({ error: '素材在库中不存在' })

    const job = newJob()
    running = job.id
    job.total = rows.length
    res.json({ jobId: job.id })

    ;(async () => {
      const result = await renderVideo({
        assets: rows.map(toAsset),
        placeName: placeName || '旅行',
        aspect: aspect || '16:9',
        bgm: bgm || null,
        length: length || 'medium',
      }, (phase, processed, total) => { job.phase = phase; job.processed = processed; job.total = total })
      job.name = result.name
      job.status = 'done'
    })().catch((e) => { job.status = 'error'; job.error = e.message })
      .finally(() => { if (running === job.id) running = null })
  })

  // 轮询进度
  r.get('/jobs/:id', (req, res) => {
    const job = jobs.get(req.params.id)
    if (!job) return res.status(404).json({ error: '任务不存在' })
    if (job.status !== 'done') {
      const { id, status, phase, processed, total, error } = job
      return res.json({ id, status, phase, processed, total, error })
    }
    res.json(job)
  })

  // 可用曲目
  r.get('/music', (req, res) => {
    let files = []
    try { files = fs.readdirSync(MUSIC_DIR) } catch { files = [] }
    res.json({ music: files.filter((f) => AUDIO_EXTS.has(path.extname(f).toLowerCase())).sort() })
  })

  // 已生成成片列表
  r.get('/', (req, res) => {
    let files = []
    try { files = fs.readdirSync(EXPORTS_DIR) } catch { files = [] }
    const videos = files.filter((f) => f.toLowerCase().endsWith('.mp4')).map((f) => {
      const st = fs.statSync(path.join(EXPORTS_DIR, f))
      return { name: f, size: st.size, mtime: st.mtimeMs }
    }).sort((a, b) => b.mtime - a.mtime)
    res.json({ videos })
  })

  // 播放/下载（res.sendFile 支持 Range，供 <video> 拖动进度）
  r.get('/:name', (req, res) => {
    const name = path.basename(req.params.name)
    const abs = path.join(EXPORTS_DIR, name)
    if (!abs.startsWith(EXPORTS_DIR) || !fs.existsSync(abs)) return res.status(404).json({ error: '成片不存在' })
    res.sendFile(abs)
  })

  // 删除
  r.delete('/:name', (req, res) => {
    const name = path.basename(req.params.name)
    const abs = path.join(EXPORTS_DIR, name)
    if (!abs.startsWith(EXPORTS_DIR) || !fs.existsSync(abs)) return res.status(404).json({ error: '成片不存在' })
    fs.unlinkSync(abs)
    res.json({ ok: true, name })
  })

  return r
}
```

- [ ] **Step 5: 挂载到 index.js**

在 `server/index.js` 导入区加入：

```js
import { videosRouter } from './routes/videos.js'
```

在 `app.use('/api/import', importRouter(db, geo))` 之后加入：

```js
// 旅行成片：渲染为写操作，纳入鉴权
app.use('/api/videos', writeAuthGuard)
app.use('/api/videos', videosRouter(db))
```

- [ ] **Step 6: 运行验证通过**

Run: `node --test server/videos-route.test.js`
Expected: PASS（5 个用例全绿）

- [ ] **Step 7: 全量测试**

Run: `npm test`
Expected: 全绿。

- [ ] **Step 8: 提交**

```bash
git add server/db.js server/routes/videos.js server/videos-route.test.js server/index.js
git commit -m "feat: 成片后端路由——后台 job/进度/列表/曲目/播放/删除，挂载 /api/videos"
```

---

### Task 7: 前端 API 封装

**Files:**
- Modify: `src/api.js`

**Interfaces:**
- Produces:
  - `listMusic(): Promise<string[]>`
  - `renderVideo(payload): Promise<{ jobId }>`
  - `getVideoJob(id): Promise<object>`
  - `listVideos(): Promise<{ name, size, mtime }[]>`
  - `deleteVideo(name): Promise<object>`
  - `videoUrl(name): string`

- [ ] **Step 1: 追加 API**

在 `src/api.js` 末尾追加：

```js
// ---- 旅行成片（按地点选段 → 后台渲染 → exports 产物）----
export const listMusic = () => fetch('/api/videos/music').then(j).then((d) => d.music)
export const renderVideo = (payload) =>
  fetch('/api/videos/render', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  }).then(j)
export const getVideoJob = (id) => fetch(`/api/videos/jobs/${id}`, { headers: authHeaders() }).then(j)
export const listVideos = () => fetch('/api/videos', { headers: authHeaders() }).then(j).then((d) => d.videos)
export const deleteVideo = (name) =>
  fetch(`/api/videos/${encodeURIComponent(name)}`, { method: 'DELETE', headers: authHeaders() }).then(j)
export const videoUrl = (name) => `/api/videos/${encodeURIComponent(name)}`
```

- [ ] **Step 2: 构建校验**

Run: `npm run build`
Expected: 编译通过。

- [ ] **Step 3: 提交**

```bash
git add src/api.js
git commit -m "feat: 前端成片 API 封装(listMusic/renderVideo/getVideoJob/listVideos/deleteVideo/videoUrl)"
```

---

### Task 8: 素材筛选与参数对话框

**Files:**
- Create: `src/components/VideoDialog.jsx`
- Modify: `src/components/PhotoPanel.jsx`
- Modify: `src/pages/MapPage.jsx`
- Modify: `src/app.css`

**Interfaces:**
- Produces:
  - `VideoDialog({ photos, placeName, onClose })`：默认全选、可取消/全选/反选；画幅/BGM/时长档；生成 → 轮询进度 → 预览/下载。
  - `PhotoPanel` 新增可选 prop `onGenerate(photos, placeName)`，在面板头部渲染"生成旅行视频"按钮。
- Consumes: `listMusic`、`renderVideo`、`getVideoJob`、`videoUrl`

- [ ] **Step 1: 实现 VideoDialog**

创建 `src/components/VideoDialog.jsx`：

```jsx
import { useEffect, useRef, useState } from 'react'
import { listMusic, renderVideo, getVideoJob, videoUrl } from '../api.js'

// 素材筛选 + 参数 + 进度 + 预览。photos: 该地点全部照片/视频（含 id/filename/thumb_path/media_type）
export default function VideoDialog({ photos, placeName, onClose }) {
  const [selected, setSelected] = useState(() => new Set(photos.map((p) => p.id)))
  const [aspect, setAspect] = useState('16:9')
  const [length, setLength] = useState('medium')
  const [music, setMusic] = useState([])
  const [bgm, setBgm] = useState('')
  const [phase, setPhase] = useState('setup') // setup | running | done | error
  const [progress, setProgress] = useState({ phase: '', processed: 0, total: 0 })
  const [output, setOutput] = useState(null)
  const [error, setError] = useState('')
  const timerRef = useRef(null)

  useEffect(() => { listMusic().then(setMusic).catch(() => {}) }, [])
  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current) }, [])

  const toggle = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const allIds = photos.map((p) => p.id)
  const selectAll = () => setSelected(new Set(allIds))
  const invert = () => setSelected((s) => new Set(allIds.filter((id) => !s.has(id))))

  const generate = async () => {
    if (selected.size === 0) return
    setPhase('running'); setError('')
    try {
      const fileNames = photos.filter((p) => selected.has(p.id)).map((p) => p.filename)
      const { jobId } = await renderVideo({ fileNames, placeName, aspect, bgm: bgm || null, length })
      timerRef.current = setInterval(async () => {
        try {
          const j = await getVideoJob(jobId)
          if (j.status === 'running') { setProgress({ phase: j.phase, processed: j.processed, total: j.total }); return }
          clearInterval(timerRef.current)
          if (j.status === 'error') { setError(j.error || '渲染失败'); setPhase('error'); return }
          setOutput(j.name); setPhase('done')
        } catch (e) {
          clearInterval(timerRef.current); setError(e.message); setPhase('error')
        }
      }, 800)
    } catch (e) {
      setError(e.message); setPhase('error')
    }
  }

  const pct = progress.total ? Math.round((progress.processed / progress.total) * 100) : 0

  return (
    <div className="video-dialog-backdrop" onClick={onClose}>
      <div className="video-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="video-dialog-head">
          <strong>生成旅行视频 · {placeName}</strong>
          <button className="panel-close" onClick={onClose} title="关闭">×</button>
        </div>

        {phase === 'setup' && (
          <>
            <div className="video-dialog-toolbar">
              <span>已选 {selected.size}/{photos.length}</span>
              <button className="btn btn-ghost" onClick={selectAll}>全选</button>
              <button className="btn btn-ghost" onClick={() => setSelected(new Set())}>清空</button>
              <button className="btn btn-ghost" onClick={invert}>反选</button>
            </div>
            <div className="video-dialog-grid">
              {photos.map((p) => (
                <div
                  key={p.id}
                  className={`video-dialog-item${selected.has(p.id) ? ' on' : ''}`}
                  onClick={() => toggle(p.id)}
                >
                  {p.media_type === 'video'
                    ? <video src={`/uploads/${p.filename}`} poster={`/uploads/${p.thumb_path}`} muted preload="metadata" />
                    : <img src={`/uploads/${p.thumb_path}`} alt={p.original_name} loading="lazy" />}
                  <span className="video-dialog-check">{selected.has(p.id) ? '✓' : ''}</span>
                </div>
              ))}
            </div>
            <div className="video-dialog-controls">
              <label>画幅
                <select value={aspect} onChange={(e) => setAspect(e.target.value)}>
                  <option value="16:9">横屏 16:9</option>
                  <option value="9:16">竖屏 9:16</option>
                </select>
              </label>
              <label>时长
                <select value={length} onChange={(e) => setLength(e.target.value)}>
                  <option value="short">短 ≈30s</option>
                  <option value="medium">中 ≈60s</option>
                  <option value="long">长 ≈120s</option>
                </select>
              </label>
              <label>背景音乐
                <select value={bgm} onChange={(e) => setBgm(e.target.value)}>
                  <option value="">无</option>
                  {music.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </label>
            </div>
            <div className="video-dialog-actions">
              <button className="btn btn-primary" disabled={selected.size === 0} onClick={generate}>开始生成</button>
            </div>
          </>
        )}

        {phase === 'running' && (
          <div className="import-progress">
            <p>{progress.phase === 'analyze' ? '正在分析素材…' : progress.phase === 'compose' ? '正在合成…' : `正在渲染 ${progress.processed}/${progress.total}`}</p>
            <div className="bar"><span style={{ width: `${pct}%` }} /></div>
          </div>
        )}

        {phase === 'done' && output && (
          <div className="video-dialog-result">
            <video src={videoUrl(output)} controls autoPlay style={{ width: '100%', borderRadius: 8 }} />
            <div className="video-dialog-actions">
              <a className="btn btn-primary" href={videoUrl(output)} download={output}>下载</a>
              <button className="btn btn-ghost" onClick={onClose}>完成</button>
            </div>
          </div>
        )}

        {phase === 'error' && (
          <div className="empty">
            <div className="empty-title">生成失败</div>
            <p>{error}</p>
            <button className="btn btn-primary" onClick={() => setPhase('setup')}>返回</button>
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: PhotoPanel 加按钮**

在 `src/components/PhotoPanel.jsx` 顶部修改签名并加按钮：

```jsx
export default function PhotoPanel({ filter, photos, label, onClose, onDeleted, onGenerate }) {
```

在 `photo-panel-head` 的 `panel-actions` 之前插入按钮：

```jsx
        <div className="panel-actions">
          {onGenerate && (
            <button className="btn btn-ghost panel-generate" disabled={shown.length === 0}
              onClick={() => onGenerate(shown, place)}>生成旅行视频</button>
          )}
          <button className="panel-toggle" onClick={() => setCollapsed(true)} title="折叠">▶</button>
          <button className="panel-close" onClick={onClose} title="关闭">×</button>
        </div>
```

（删除原 `<div className="panel-actions">` 内重复的 toggle/close，确保只保留一处。）

- [ ] **Step 3: MapPage 承载对话框**

在 `src/pages/MapPage.jsx` 导入：

```jsx
import VideoDialog from '../components/VideoDialog.jsx'
```

在组件状态区加：

```jsx
  const [videoFor, setVideoFor] = useState(null)
```

给 `PhotoPanel` 增加 prop：

```jsx
        onGenerate={(photos, placeName) => setVideoFor({ photos, placeName })}
```

在 `<PhotoPanel ... />` 之后渲染：

```jsx
      {videoFor && (
        <VideoDialog photos={videoFor.photos} placeName={videoFor.placeName} onClose={() => setVideoFor(null)} />
      )}
```

- [ ] **Step 4: 追加样式**

在 `src/app.css` 末尾追加：

```css
/* ---- 成片对话框 ---- */
.video-dialog-backdrop { position: fixed; inset: 0; background: rgba(20,18,15,0.55); z-index: 60; display: flex; align-items: center; justify-content: center; padding: 24px; }
.video-dialog { background: var(--surface); border: 1px solid var(--line-strong); border-radius: var(--radius); width: min(880px, 96vw); max-height: 90vh; overflow: auto; padding: 16px; box-shadow: 0 18px 60px rgba(0,0,0,0.35); }
.video-dialog-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.video-dialog-toolbar { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; font-size: 13px; color: var(--ink-soft); }
.video-dialog-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 6px; max-height: 46vh; overflow: auto; padding: 4px; }
.video-dialog-item { position: relative; aspect-ratio: 1; border: 2px solid transparent; border-radius: 6px; overflow: hidden; cursor: pointer; opacity: 0.55; }
.video-dialog-item.on { opacity: 1; border-color: var(--vermillion); }
.video-dialog-item img, .video-dialog-item video { width: 100%; height: 100%; object-fit: cover; display: block; }
.video-dialog-check { position: absolute; top: 4px; right: 4px; width: 18px; height: 18px; line-height: 18px; text-align: center; border-radius: 50%; background: var(--vermillion); color: #fff; font-size: 12px; }
.video-dialog-controls { display: flex; flex-wrap: wrap; gap: 16px; margin: 14px 0; font-size: 13px; }
.video-dialog-controls label { display: flex; flex-direction: column; gap: 4px; color: var(--ink-soft); }
.video-dialog-actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 12px; }
.video-dialog-result { display: flex; flex-direction: column; gap: 8px; }
.panel-generate { margin-right: 4px; }
```

- [ ] **Step 5: 构建校验**

Run: `npm run build`
Expected: 编译通过。

- [ ] **Step 6: 提交**

```bash
git add src/components/VideoDialog.jsx src/components/PhotoPanel.jsx src/pages/MapPage.jsx src/app.css
git commit -m "feat: 成片前端对话框——地图地点面板一键筛选素材/选画幅画幅BGM/进度/预览下载"
```

---

### Task 9: 「我的成片」页面

**Files:**
- Create: `src/pages/VideosPage.jsx`
- Modify: `src/App.jsx`
- Modify: `src/app.css`

**Interfaces:**
- Produces: `VideosPage`（列出 `exports/`，播放/下载/删除）
- Consumes: `listVideos`、`deleteVideo`、`videoUrl`

- [ ] **Step 1: 实现页面**

创建 `src/pages/VideosPage.jsx`：

```jsx
import { useEffect, useState } from 'react'
import { listVideos, deleteVideo, videoUrl } from '../api.js'

function fmtSize(n) {
  if (!n) return '0'
  if (n > 2 ** 20) return (n / 2 ** 20).toFixed(0) + ' MB'
  return Math.max(1, Math.round(n / 2 ** 10)) + ' KB'
}

export default function VideosPage() {
  const [videos, setVideos] = useState([])
  const [playing, setPlaying] = useState(null)

  const load = () => listVideos().then(setVideos).catch(() => setVideos([]))
  useEffect(() => { load() }, [])

  const remove = async (name) => {
    if (!window.confirm(`删除成片「${name}」？`)) return
    await deleteVideo(name)
    if (playing === name) setPlaying(null)
    load()
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">travel films</div>
          <h1 className="page-title">我的成片</h1>
          <p className="page-sub">在地图上点开某个地点，即可一键生成旅行视频；生成的成片都保存在这里。</p>
        </div>
      </div>

      {videos.length === 0 ? (
        <div className="empty">
          <div className="empty-title">还没有成片</div>
          <p>去地图点击一个地点聚类，选择"生成旅行视频"。</p>
        </div>
      ) : (
        <div className="videos-grid">
          {videos.map((v) => (
            <div key={v.name} className="video-card">
              {playing === v.name
                ? <video src={videoUrl(v.name)} controls autoPlay />
                : <video src={videoUrl(v.name)} controls preload="metadata" />}
              <div className="video-card-meta">
                <span className="video-card-name" title={v.name}>{v.name}</span>
                <span className="video-card-sub">{fmtSize(v.size)}</span>
              </div>
              <div className="video-card-actions">
                <a className="btn btn-ghost" href={videoUrl(v.name)} download={v.name}>下载</a>
                <button className="btn btn-ghost" onClick={() => remove(v.name)}>删除</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: 路由与导航**

在 `src/App.jsx` 导入：

```jsx
import VideosPage from './pages/VideosPage.jsx'
```

导航加一项：

```jsx
          <NavLink to="/videos" className={({ isActive }) => (isActive ? 'active' : '')}>成片</NavLink>
```

路由加一条：

```jsx
        <Route path="/videos" element={<VideosPage />} />
```

- [ ] **Step 3: 样式**

在 `src/app.css` 末尾追加：

```css
.videos-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; }
.video-card { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden; display: flex; flex-direction: column; }
.video-card video { width: 100%; display: block; background: #000; }
.video-card-meta { display: flex; flex-direction: column; gap: 2px; padding: 8px 10px; }
.video-card-name { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.video-card-sub { font-size: 12px; color: var(--ink-soft); }
.video-card-actions { display: flex; gap: 8px; padding: 0 10px 10px; }
```

- [ ] **Step 4: 构建校验**

Run: `npm run build`
Expected: 编译通过。

- [ ] **Step 5: 提交**

```bash
git add src/pages/VideosPage.jsx src/App.jsx src/app.css
git commit -m "feat: 「我的成片」页面——列出 exports 成片，支持播放/下载/删除"
```

---

### Task 10: 文档与端到端验证

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: AGENTS.md 补说明**

在 `## 架构要点` 列表末尾追加一条：

```markdown
- **旅行成片**：地图地点面板 → 筛选素材 → 后台 job（`/api/videos`，内存、全局单任务）→ 两阶段 ffmpeg（逐素材归一化 → xfade 拼接 + `ass` 字幕 + `amix` 混音）→ `exports/<地点>-<时间戳>.mp4`（`EXPORTS_DIR` 可覆盖），**不入库**。择优走 `server/analyze.js`（sharp 启发式，provider 接口占位）。BGM 从 `MUSIC_DIR`（默认 `server/data/music`）选曲，目录为空则无 BGM。字幕统一走 ASS/libass，**只用系统字体**：Linux 需 `sudo apt install fonts-noto-cjk`，`VIDEO_FONT` 可覆盖字体名；缺字体时静默无字幕。`ffmpeg-static` 不含 drawtext，故不用 drawtext。
```

- [ ] **Step 2: 全量测试**

Run: `npm test`
Expected: 全绿（含新增 `analyze.test.js`、`video-render.test.js`、`videos-route.test.js`）。

- [ ] **Step 3: 生产构建**

Run: `npm run build`
Expected: 构建成功。

- [ ] **Step 4: 端到端手测**

启动 `npm run dev`，浏览器打开 `http://localhost:5173`：
1. 地图点一个有照片的地点聚类 → 面板出现"生成旅行视频"。
2. 点开 → 默认全选，勾掉几张 → 选 16:9 / 无 BGM / 短 → 开始生成 → 进度条推进 → 完成后内嵌播放器可播放、可下载。
3. 再生成一条 9:16 带 BGM（`server/data/music` 放一首 mp3）→ 验证混音与竖版排版。
4. 进「成片」页 → 两条成片可播放/下载/删除。
5. 设置 `ACCESS_TOKEN=xxx` 重启 → 生成操作应要求令牌（前端弹出输入框）。

Expected: 全部符合；无中文字体时标题不显示但不报错。

- [ ] **Step 5: 提交**

```bash
git add AGENTS.md
git commit -m "docs: 补充旅行成片架构说明与系统中文字体依赖"
```

---

## Self-Review

**Spec coverage:**
- 选段＝地图地点聚类：Task 8（PhotoPanel 按钮 + VideoDialog 取该地点 photos）✅
- 素材筛选（默认全选/取消/全选/反选、全不选禁用）：Task 8 ✅
- 画幅 16:9 与 9:16：Task 3 常量、Task 4 参数、Task 5 手测 ✅
- 照片运镜 + 转场 + 视频穿插保留原声 + 字幕：Task 4/5（zoompan/xfade/acrossfade/ass/anullsrc）✅
- BGM 本地目录选曲、空则无：Task 6 `/music` + Task 8 下拉 ✅
- 后台任务 + exports 目录 + 不入库 + 预览/下载：Task 5/6/8 ✅
- ASS + 系统字体 + VIDEO_FONT + 缺字体降级：Task 3/5 ✅
- 片头大标题（地点+日期+张数），无逐张日期：Task 3 `buildAss` ✅
- 「我的成片」列表页：Task 9 ✅
- 非 AI 择优 + provider 接口占位：Task 2 ✅
- 路径 EXPORTS_DIR/MUSIC_DIR：Task 1 ✅
- 可选鉴权：Task 6 挂载 `writeAuthGuard` ✅
- 错误处理：逐素材容错（analyze 兜底、renderVideo 整体失败）、NVENC 回退、临时目录 finally 清理：Task 2/5 ✅
- 测试：Task 2/3/4/6 单测 + Task 10 端到端 ✅

**Placeholder scan:** 无 TBD/TODO；所有代码步骤含完整代码。✅

**Type consistency:**
- `analyzeAssets(items: {id, filename, imagePath})` → Task 5 传入的 assets 含这些字段 ✅
- `planTimeline` 消费 `{ id, filename, mediaType, takenAt, duration, score }`，Task 5 传入 ✅
- `buildConcatArgs` 的 `clips[{path,duration,hasAudio}]`、`assPath`（相对）、`encoder{gpu,crf}`：Task 4 定义、Task 5 调用一致 ✅
- `toAsset`（videos.js）→ `assets` 含 `mediaPath/imagePath`，与 `renderVideo` 消费一致 ✅
- 路由路径 `/music`、`/jobs/:id`、`/render` 均在 `/:name` 之前注册 ✅
