// 统一的运行时路径解析：开发态按项目源码布局；打包态数据落在程序目录。
// 两种打包形态：
//   - pkg 单文件（process.pkg 注入）：BASE_DIR = exe 同目录
//   - 便携文件夹（启动脚本设 PORTABLE_APP=1）：BASE_DIR = 启动时的工作目录
// env 变量（DB_PATH/UPLOAD_DIR/GEO_DIR）始终优先。
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const IS_PACKAGED = Boolean(process.pkg)
export const PORTABLE_MODE = IS_PACKAGED || process.env.PORTABLE_APP === '1'
export const BASE_DIR = IS_PACKAGED
  ? path.dirname(process.execPath)
  : process.env.PORTABLE_APP === '1'
    ? process.cwd()
    : path.resolve(__dirname, '..')

export const DATA_DIR = PORTABLE_MODE ? path.join(BASE_DIR, 'data') : path.join(BASE_DIR, 'server', 'data')

export const DB_PATH = path.resolve(process.env.DB_PATH || path.join(DATA_DIR, 'app.db'))
export const GEO_DIR = path.resolve(process.env.GEO_DIR || path.join(DATA_DIR, 'geojson'))
export const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(BASE_DIR, 'uploads'))
export const DIST_DIR = path.join(BASE_DIR, 'dist')
export const BACKUPS_DIR = path.join(BASE_DIR, 'backups')
