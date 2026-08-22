// 统一的运行时路径解析：开发态按项目源码布局，打包态（@yao-pkg/pkg 注入 process.pkg）
// 所有可写数据落在 exe 同目录。env 变量（DB_PATH/UPLOAD_DIR/GEO_DIR）始终优先。
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const IS_PACKAGED = Boolean(process.pkg)
export const BASE_DIR = IS_PACKAGED ? path.dirname(process.execPath) : path.resolve(__dirname, '..')

export const DATA_DIR = IS_PACKAGED ? path.join(BASE_DIR, 'data') : path.join(BASE_DIR, 'server', 'data')

export const DB_PATH = path.resolve(process.env.DB_PATH || path.join(DATA_DIR, 'app.db'))
export const GEO_DIR = path.resolve(process.env.GEO_DIR || path.join(DATA_DIR, 'geojson'))
export const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(BASE_DIR, 'uploads'))
export const DIST_DIR = path.join(BASE_DIR, 'dist')
export const BACKUPS_DIR = path.join(BASE_DIR, 'backups')
