// 备份数据库与照片文件：npm run backup
// - SQLite 用 better-sqlite3 在线 backup API（WAL 模式下也能安全备份）
// - uploads/ 打包为 tar.gz
// 产物写入项目根目录 backups/（git-ignored）
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import Database from 'better-sqlite3'
import { DB_PATH as DEFAULT_DB_PATH, BACKUPS_DIR, BASE_DIR, UPLOAD_DIR } from '../paths.js'

const execFileAsync = promisify(execFile)
const outDir = BACKUPS_DIR
fs.mkdirSync(outDir, { recursive: true })
const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')

// 1) 数据库在线备份
const dbPath = DEFAULT_DB_PATH
if (!fs.existsSync(dbPath)) {
  console.error(`数据库不存在: ${dbPath}`)
  process.exit(1)
}
const dbDest = path.join(outDir, `app-${stamp}.db`)
await new Database(dbPath, { readonly: true }).backup(dbDest)
console.log(`✓ 数据库已备份: ${path.relative(BASE_DIR, dbDest)}`)

// 2) uploads 目录打包
const uploadsDir = UPLOAD_DIR
if (fs.existsSync(uploadsDir)) {
  const tarDest = path.join(outDir, `uploads-${stamp}.tar.gz`)
  await execFileAsync('tar', ['-czf', tarDest, '-C', path.dirname(UPLOAD_DIR), path.basename(UPLOAD_DIR)])
  console.log(`✓ 照片文件已打包: ${path.relative(BASE_DIR, tarDest)}`)
}

console.log(`\n完成。建议定期把 backups/ 拷贝到其他磁盘或网盘异地保存。`)
