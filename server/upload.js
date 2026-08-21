import multer from 'multer'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import heicDecode from 'heic-decode'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const UPLOAD_DIR = path.resolve(__dirname, '../uploads')
const THUMB_DIR = path.join(UPLOAD_DIR, 'thumbs')
const FULL_DIR = path.join(UPLOAD_DIR, 'full')
fs.mkdirSync(THUMB_DIR, { recursive: true })
fs.mkdirSync(FULL_DIR, { recursive: true })

export const uploadDir = UPLOAD_DIR

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg'
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`)
  },
})

export const upload = multer({ storage, limits: { fileSize: 30 * 1024 * 1024 } })

// sharp 预编译版不含 HEVC/HEIC 解码器，需先用 heic-decode 转成原始像素
async function loadImage(src) {
  const lower = src.toLowerCase()
  const isHeic = lower.endsWith('.heic') || lower.endsWith('.heif')
  if (!isHeic) return sharp(src)
  const { data, width, height } = await heicDecode({ buffer: fs.readFileSync(src) })
  return sharp(data, { raw: { width, height, channels: 4 } })
}

export async function makeThumb(filename) {
  const src = path.join(UPLOAD_DIR, filename)
  const img = await loadImage(src)
  const base = path.basename(filename)
  const thumbName = `thumb-${base}`
  const fullName = `full-${base}`
  await img.clone().resize({ width: 600, withoutEnlargement: true }).jpeg({ quality: 80 }).toFile(path.join(THUMB_DIR, thumbName))
  // 大图统一转为 JPEG（浏览器可直接显示，解决 HEIC 大图打不开）
  await img.resize({ width: 1600, withoutEnlargement: true }).jpeg({ quality: 85 }).toFile(path.join(FULL_DIR, fullName))
  return { thumb: `thumbs/${thumbName}`, full: `full/${fullName}` }
}

// 永久旋转：按累计角度从原始文件旋转，重新生成缩略图与大图（浏览器显示用），原图保留
export async function rotatePhoto(filename, totalDegrees) {
  const src = path.join(UPLOAD_DIR, filename)
  const img = await loadImage(src)
  const base = path.basename(filename)
  const thumbName = `thumb-${base}`
  const fullName = `full-${base}`
  await img.clone().rotate(totalDegrees).resize({ width: 600, withoutEnlargement: true }).jpeg({ quality: 80 }).toFile(path.join(THUMB_DIR, thumbName))
  await img.rotate(totalDegrees).resize({ width: 1600, withoutEnlargement: true }).jpeg({ quality: 85 }).toFile(path.join(FULL_DIR, fullName))
  return { thumb: `thumbs/${thumbName}`, full: `full/${fullName}` }
}
