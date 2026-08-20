import multer from 'multer'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

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

export async function makeThumb(filename) {
  const src = path.join(UPLOAD_DIR, filename)
  const thumbName = `thumb-${path.basename(filename)}`
  const dest = path.join(THUMB_DIR, thumbName)
  await sharp(src).resize({ width: 600, withoutEnlargement: true }).jpeg({ quality: 80 }).toFile(dest)
  return `thumbs/${thumbName}`
}
