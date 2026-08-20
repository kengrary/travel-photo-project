import multer from 'multer'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import heicDecode from 'heic-decode'

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
  const thumbName = `thumb-${path.basename(filename)}`
  const dest = path.join(THUMB_DIR, thumbName)
  const img = await loadImage(src)
  await img.resize({ width: 600, withoutEnlargement: true }).jpeg({ quality: 80 }).toFile(dest)
  return `thumbs/${thumbName}`
}
