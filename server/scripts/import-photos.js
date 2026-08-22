// 批量导入本地照片/视频目录（CLI）
// 用法：node server/scripts/import-photos.js <照片目录> [--dry-run] [过滤参数...]
// 核心扫描/导入逻辑在 ../import-core.js，与网页「批量导入」共用
import fs from 'node:fs'
import path from 'node:path'
import { openDb } from '../db.js'
import { loadGeoIndex } from '../geocode.js'
import { collectMediaFiles, prepareItem, commitItem } from '../import-core.js'

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
  let noOriginal = false
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--include-province' && args[i + 1]) { includeProvinces.add(args[++i]); }
    if (a === '--exclude-province' && args[i + 1]) { excludeProvinces.add(args[++i]); }
    if (a === '--exclude-city' && args[i + 1]) { excludeCities.add(args[++i]); }
    if (a === '--no-location') onlyNoLocation = true
    if (a === '--with-meta') onlyWithMeta = true
    if (a === '--no-original') noOriginal = true
    if (a === '--ext' && args[i + 1]) {
      // 支持逗号分隔的多个扩展名，如 --ext heic,jpg
      for (const e of args[++i].split(',')) if (e) includeExts.add(e.trim().replace(/^\./, '').toLowerCase())
    }
  }

  if (!dirArg) {
    console.error('用法: node server/scripts/import-photos.js <照片目录> [--dry-run] [--include-province 广东省] [--exclude-province 广东省] [--exclude-city 佛山市] [--no-location] [--with-meta] [--no-original] [--ext heic,jpg]')
    process.exit(1)
  }
  const srcDir = path.resolve(dirArg)
  if (!fs.existsSync(srcDir)) {
    console.error(`目录不存在: ${srcDir}`)
    process.exit(1)
  }

  const db = openDb()
  const geo = loadGeoIndex()

  const files = collectMediaFiles(srcDir)
  console.log(`扫描到 ${files.length} 个媒体文件（${srcDir}）`)
  if (includeProvinces.size) console.log(`过滤：仅导入 ${[...includeProvinces].join('、')}`)
  if (excludeProvinces.size) console.log(`过滤：排除 ${[...excludeProvinces].join('、')}`)
  if (excludeCities.size) console.log(`过滤：排除城市 ${[...excludeCities].join('、')}`)
  if (onlyNoLocation) console.log('过滤：仅导入无位置照片')
  if (onlyWithMeta) console.log('过滤：跳过无时间且无位置的照片')
  if (noOriginal) console.log('模式：不复制原图，仅生成缩略图+大图')
  if (dryRun) console.log('模式：试运行，不写库不落盘')
  if (includeExts.size) console.log(`过滤：仅导入 ${[...includeExts].join(', ')} 格式`)

  let ok = 0, skipped = 0, failed = 0, filtered = 0
  for (let i = 0; i < files.length; i++) {
    const src = files[i]
    const ext = path.extname(src).replace(/^\./, '').toLowerCase()

    // 扩展名过滤
    if (includeExts.size && !includeExts.has(ext)) { filtered++; continue }

    // 读元数据+定位+查重（已导入过返回 null）
    let item = null
    try {
      item = await prepareItem(db, geo, src)
    } catch (e) {
      console.log(`[${i + 1}/${files.length}] ✗ ${path.basename(src)}: ${e.message}`)
      failed++
      continue
    }
    if (!item) { skipped++; continue }

    // 过滤：根据反查到的省份/城市决定是否导入
    if (onlyNoLocation && item.province) { filtered++; continue }
    if (includeProvinces.size && !(item.province && includeProvinces.has(item.province))) { filtered++; continue }
    if (excludeProvinces.size && item.province && excludeProvinces.has(item.province)) { filtered++; continue }
    if (excludeCities.size && item.city && excludeCities.has(item.city)) { filtered++; continue }
    // 跳过既无时间也无位置的照片
    if (onlyWithMeta && !item.province && !item.takenAt) { filtered++; continue }

    try {
      if (!dryRun) await commitItem(db, item, { noOriginal })
      const loc = item.province ? `${item.province} ${item.city || ''} ${item.county || ''}` : '无位置'
      const dur = item.mediaType === 'video' && item.duration ? ` ${Math.round(item.duration)}s` : ''
      console.log(`[${i + 1}/${files.length}] ${dryRun ? '·' : '✓'} ${item.fileName} -> ${loc} ${item.takenAt ? item.takenAt.slice(0, 10) : '无时间'}${dur}`)
      ok++
    } catch (e) {
      console.log(`[${i + 1}/${files.length}] ✗ ${path.basename(src)}: ${e.message}`)
      failed++
    }
  }

  console.log(`\n完成：成功 ${ok}，跳过(已导入) ${skipped}，过滤排除 ${filtered}，失败 ${failed}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
