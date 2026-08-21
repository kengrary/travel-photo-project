// 批量导入本地照片目录
// 用法：node server/scripts/import-photos.js <照片目录> [--dry-run]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import exifr from 'exifr'
import { openDb, insertPhoto } from '../db.js'
import { makeThumb, uploadDir } from '../upload.js'
import { loadGeoIndex, reverseGeocode } from '../geocode.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.heic', '.heif', '.webp', '.gif', '.bmp', '.tif', '.tiff'])

function collectImages(dir, out = []) {
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      collectImages(full, out)
    } else if (e.isFile() && IMAGE_EXTS.has(path.extname(e.name).toLowerCase())) {
      out.push(full)
    }
  }
  return out
}

function normalizeTakenAt(v) {
  if (v instanceof Date) return v.toISOString()
  if (v != null && typeof v !== 'string') return String(v)
  return v
}

async function main() {
  const args = process.argv.slice(2)
  const dirArg = args.find((a) => !a.startsWith('--'))
  const dryRun = args.includes('--dry-run')

  // 过滤参数
  const includeProvinces = new Set()
  const excludeProvinces = new Set()
  const excludeCities = new Set()
  let onlyNoLocation = false
  let onlyWithMeta = false
  const includeExts = new Set()
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--include-province' && args[i + 1]) { includeProvinces.add(args[++i]); }
    if (a === '--exclude-province' && args[i + 1]) { excludeProvinces.add(args[++i]); }
    if (a === '--exclude-city' && args[i + 1]) { excludeCities.add(args[++i]); }
    if (a === '--no-location') onlyNoLocation = true
    if (a === '--with-meta') onlyWithMeta = true
    if (a === '--ext' && args[i + 1]) {
      // 支持逗号分隔的多个扩展名，如 --ext heic,jpg
      for (const e of args[++i].split(',')) if (e) includeExts.add(e.trim().replace(/^\./, '').toLowerCase())
    }
  }

  if (!dirArg) {
    console.error('用法: node server/scripts/import-photos.js <照片目录> [--dry-run] [--include-province 广东省] [--exclude-province 广东省] [--exclude-city 佛山市] [--no-location] [--with-meta] [--ext heic,jpg]')
    process.exit(1)
  }
  const srcDir = path.resolve(dirArg)
  if (!fs.existsSync(srcDir)) {
    console.error(`目录不存在: ${srcDir}`)
    process.exit(1)
  }

  const db = openDb()
  const geo = loadGeoIndex()

  const hasOriginCol = db.prepare('PRAGMA table_info(photos)').all().some((c) => c.name === 'origin_path')
  const hasSizeCol = db.prepare('PRAGMA table_info(photos)').all().some((c) => c.name === 'size_bytes')

  const images = collectImages(srcDir)
  console.log(`扫描到 ${images.length} 张图片（${srcDir}）`)
  if (includeProvinces.size) console.log(`过滤：仅导入 ${[...includeProvinces].join('、')}`)
  if (excludeProvinces.size) console.log(`过滤：排除 ${[...excludeProvinces].join('、')}`)
  if (excludeCities.size) console.log(`过滤：排除城市 ${[...excludeCities].join('、')}`)
  if (onlyNoLocation) console.log('过滤：仅导入无位置照片')
  if (onlyWithMeta) console.log('过滤：跳过无时间且无位置的照片')
  if (includeExts.size) console.log(`过滤：仅导入 ${[...includeExts].join(', ')} 格式`)

  let ok = 0, skipped = 0, failed = 0, filtered = 0
  for (let i = 0; i < images.length; i++) {
    const src = images[i]
    const ext = path.extname(src).replace(/^\./, '').toLowerCase()

    // 扩展名过滤
    if (includeExts.size && !includeExts.has(ext)) { filtered++; continue }

    const stat = fs.statSync(src)
    const base = `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(src).toLowerCase()}`
    const dest = path.join(uploadDir, base)

    // 去重：有 origin_path 列则精确按来源路径，否则按 (文件名, 大小) 粗略
    let already = false
    if (hasOriginCol) {
      already = !!db.prepare('SELECT id FROM photos WHERE origin_path = ?').get(src)
    } else if (hasSizeCol) {
      already = !!db.prepare('SELECT id FROM photos WHERE original_name = ? AND size_bytes = ?').get(path.basename(src), stat.size)
    }
    if (already) { skipped++; continue }

    try {
      if (!dryRun) fs.copyFileSync(src, dest)
      const meta = await exifr.parse(dryRun ? src : dest, { gps: true, tiff: true })
      const lat = meta?.latitude ?? null
      const lng = meta?.longitude ?? null
      let takenAt = normalizeTakenAt(meta?.DateTimeOriginal ?? null)
      let province = null, city = null, county = null
      if (lat != null && lng != null) {
        const r = reverseGeocode(geo, lng, lat)
        province = r.province; city = r.city; county = r.county
      }

      // 过滤：根据反查到的省份/城市决定是否导入
      const skipFile = () => { if (!dryRun) { try { fs.unlinkSync(dest) } catch {} } }
      if (onlyNoLocation && province) { skipFile(); filtered++; continue }
      if (includeProvinces.size && !(province && includeProvinces.has(province))) { skipFile(); filtered++; continue }
      if (excludeProvinces.size && province && excludeProvinces.has(province)) { skipFile(); filtered++; continue }
      if (excludeCities.size && city && excludeCities.has(city)) { skipFile(); filtered++; continue }
      // 跳过既无时间也无位置的照片
      if (onlyWithMeta && !province && !takenAt) { skipFile(); filtered++; continue }

      let thumb = null, full = null
      if (!dryRun) {
        const t = await makeThumb(base)
        thumb = t.thumb; full = t.full
      }

      if (!dryRun) {
        insertPhoto(db, {
          filename: base,
          original_name: path.basename(src),
          thumb_path: thumb,
          full_path: full,
          taken_at: takenAt,
          lat, lng, province, city, county,
          location_name: null,
          size_bytes: stat.size,
          created_at: new Date().toISOString(),
        })
        if (hasOriginCol) {
          db.prepare('UPDATE photos SET origin_path = ? WHERE filename = ?').run(src, base)
        }
      }
      const loc = province ? `${province} ${city || ''} ${county || ''}` : '无位置'
      console.log(`[${i + 1}/${images.length}] ✓ ${path.basename(src)} -> ${loc} ${takenAt ? takenAt.slice(0, 10) : '无时间'}`)
      ok++
    } catch (e) {
      if (!dryRun) { try { fs.unlinkSync(dest) } catch {} }
      console.log(`[${i + 1}/${images.length}] ✗ ${path.basename(src)}: ${e.message}`)
      failed++
    }
  }

  console.log(`\n完成：成功 ${ok}，跳过(已导入) ${skipped}，过滤排除 ${filtered}，失败 ${failed}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
