// 备份数据库与照片文件：npm run backup
// - SQLite 用 better-sqlite3 在线 backup API（WAL 模式下也能安全备份）
// - uploads/ 打包为 tar.gz
// 产物写入项目根目录 backups/（git-ignored）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import Database from 'better-sqlite3'

const execFileAsync = promisify(execFile)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '../..')
const outDir = path.join(root, 'backups')
fs.mkdirSync(outDir, { recursive: true })
const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')

// 1) 数据库在线备份
const dbPath = process.env.DB_PATH || path.join(root, 'server/data/app.db')
if (!fs.existsSync(dbPath)) {
  console.error(`数据库不存在: ${dbPath}`)
  process.exit(1)
}
const dbDest = path.join(outDir, `app-${stamp}.db`)
await new Database(dbPath, { readonly: true }).backup(dbDest)
console.log(`✓ 数据库已备份: ${path.relative(root, dbDest)}`)

// 2) uploads 目录打包
const uploadsDir = path.join(root, 'uploads')
if (fs.existsSync(uploadsDir)) {
  const tarDest = path.join(outDir, `uploads-${stamp}.tar.gz`)
  await execFileAsync('tar', ['-czf', tarDest, '-C', root, 'uploads'])
  console.log(`✓ 照片文件已打包: ${path.relative(root, tarDest)}`)
}

console.log(`\n完成。建议定期把 backups/ 拷贝到其他磁盘或网盘异地保存。`)
