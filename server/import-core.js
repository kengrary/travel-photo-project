// 批量导入共享逻辑：供 CLI 脚本（import-photos.js）与网页导入路由（routes/import.js）共用
// 流程拆分：collectMediaFiles 收集 → prepareItem 读元数据+定位+查重 → commitItem 落盘入库
import fs from 'node:fs'
import path from 'node:path'
import exifr from 'exifr'
import { insertPhoto } from './db.js'
import { makeThumb, makeVideoAssets, probeVideo, isVideoFile, uploadDir } from './upload.js'
import { reverseGeocode } from './geocode.js'

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.heic', '.heif', '.webp', '.gif', '.bmp', '.tif', '.tiff'])
const VIDEO_EXTS = new Set(['.mov', '.mp4', '.m4v'])
export const MEDIA_EXTS = new Set([...IMAGE_EXTS, ...VIDEO_EXTS])

export function isMediaFile(name) {
  return MEDIA_EXTS.has(path.extname(name).toLowerCase())
}

export function collectMediaFiles(dir, out = []) {
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) collectMediaFiles(full, out)
    else if (e.isFile() && isMediaFile(e.name)) out.push(full)
  }
  return out
}

function normalizeTakenAt(v) {
  if (v instanceof Date) return v.toISOString()
  if (v != null && typeof v !== 'string') return String(v)
  return v
}

// 读取单个文件的媒体元数据（GPS/拍摄时间/时长/类型）
export async function readMediaMeta(filePath) {
  const mediaType = isVideoFile(filePath) ? 'video' : 'photo'
  let lat = null, lng = null, takenAt = null, duration = null
  if (mediaType === 'video') {
    const meta = await probeVideo(filePath)
    lat = meta.lat; lng = meta.lng; takenAt = meta.takenAt; duration = meta.duration
  } else {
    const meta = await exifr.parse(filePath, { gps: true, tiff: true })
    lat = meta?.latitude ?? null
    lng = meta?.longitude ?? null
    takenAt = normalizeTakenAt(meta?.DateTimeOriginal ?? null)
  }
  return { lat, lng, takenAt, duration, mediaType }
}

// 扫描阶段：读元数据 + 离线反查省市县 + 查重。已导入过(同 origin_path)返回 null；
// opts.keepDuplicates 时仍返回条目并带 duplicate:true（网页扫描统计需要展示重复项）
export async function prepareItem(db, geo, filePath, { keepDuplicates = false } = {}) {
  const already = !!db.prepare('SELECT id FROM photos WHERE origin_path = ?').get(filePath)
  if (already && !keepDuplicates) return null
  const stat = fs.statSync(filePath)
  const meta = await readMediaMeta(filePath)
  let province = null, city = null, county = null
  if (meta.lat != null && meta.lng != null) {
    const r = reverseGeocode(geo, meta.lng, meta.lat)
    province = r.province; city = r.city; county = r.county
  }
  return {
    filePath,
    fileName: path.basename(filePath),
    sizeBytes: stat.size,
    lat: meta.lat,
    lng: meta.lng,
    takenAt: meta.takenAt,
    duration: meta.duration,
    mediaType: meta.mediaType,
    province, city, county,
    duplicate: already,
  }
}

function randomBase(filePath) {
  return `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(filePath).toLowerCase()}`
}

// 导入阶段：落盘资产 + 写库。
// opts.noOriginal 不复制原图（仅缩略图+大图）；opts.keepOriginalResolution 视频不降分辨率
export async function commitItem(db, item, { noOriginal = false, keepOriginalResolution = false } = {}) {
  const base = randomBase(item.filePath)
  const dest = path.join(uploadDir, base)
  let storedName = base, thumb = null, full = null
  try {
    if (item.mediaType === 'video') {
      // 视频直接从源文件转码（转码产物即存储文件，无需复制原图）
      const a = await makeVideoAssets(base, item.filePath, { keepOriginalResolution })
      thumb = a.thumb; full = a.full; storedName = a.video
      item.duration = a.duration ?? item.duration
    } else {
      if (!noOriginal) fs.copyFileSync(item.filePath, dest)
      const t = await makeThumb(base, noOriginal ? item.filePath : undefined)
      thumb = t.thumb; full = t.full
    }
  } catch (e) {
    if (!noOriginal && item.mediaType !== 'video') { try { fs.unlinkSync(dest) } catch {} }
    throw e
  }
  return insertPhoto(db, {
    filename: storedName,
    original_name: item.fileName,
    thumb_path: thumb,
    full_path: full,
    taken_at: item.takenAt,
    lat: item.lat,
    lng: item.lng,
    province: item.province,
    city: item.city,
    county: item.county,
    location_name: null,
    origin_path: item.filePath,
    size_bytes: item.sizeBytes,
    media_type: item.mediaType,
    duration: item.duration,
    created_at: new Date().toISOString(),
  })
}
