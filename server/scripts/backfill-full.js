// 为已有的（full_path 为空的）照片生成 JPEG 大图，补齐 full_path
import { openDb } from '../db.js'
import { makeThumb } from '../upload.js'

const db = openDb()
const rows = db.prepare(`SELECT id, filename FROM photos WHERE full_path IS NULL OR full_path = ''`).all()

for (const r of rows) {
  try {
    const { thumb, full } = await makeThumb(r.filename)
    db.prepare('UPDATE photos SET thumb_path=?, full_path=? WHERE id=?').run(thumb, full, r.id)
    console.log(`ok id=${r.id} ${r.filename} -> ${full}`)
  } catch (e) {
    console.log(`fail id=${r.id} ${r.filename}: ${e.message}`)
  }
}
console.log('done')
