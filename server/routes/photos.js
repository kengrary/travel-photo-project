import { Router } from 'express'
import exifr from 'exifr'
import path from 'node:path'
import fs from 'node:fs'
import { insertPhoto, listPhotos, countPhotos, updateLocation, updatePhotoMeta, deletePhoto, getPhoto } from '../db.js'
import { upload, makeThumb, rotatePhoto, uploadDir, isVideoFile, probeVideo, makeVideoAssets } from '../upload.js'
import { reverseGeocode } from '../geocode.js'

async function cleanupFile(file) {
  if (!file?.path) return
  try { await fs.promises.unlink(file.path) } catch {}
  const base = path.basename(file.filename)
  try {
    await fs.promises.unlink(path.join(path.dirname(file.path), 'thumbs', `thumb-${base}`))
  } catch {}
  try {
    await fs.promises.unlink(path.join(path.dirname(file.path), 'full', `full-${base}`))
  } catch {}
}

export function photosRouter(db, geo) {
  const router = Router()

  router.post('/', (req, res, next) => {
    upload.array('photos', 50)(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.message })
      next()
    })
  }, async (req, res) => {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No photos uploaded' })
    }
    const results = []
    for (const file of req.files) {
      try {
        const isVideo = isVideoFile(file.originalname)
        let lat = null, lng = null, takenAt = null, duration = null
        if (isVideo) {
          const meta = await probeVideo(file.path)
          lat = meta.lat; lng = meta.lng; takenAt = meta.takenAt; duration = meta.duration
        } else {
          const meta = await exifr.parse(file.path, { gps: true, tiff: true })
          lat = meta?.latitude ?? null
          lng = meta?.longitude ?? null
          // DateTimeOriginal 可能是 Date 对象，需转成字符串才能写入 SQLite
          takenAt = meta?.DateTimeOriginal ?? null
          if (takenAt instanceof Date) takenAt = takenAt.toISOString()
          else if (takenAt != null && typeof takenAt !== 'string') takenAt = String(takenAt)
        }
        let province = null, city = null, county = null
        if (lat != null && lng != null) {
          const r = reverseGeocode(geo, lng, lat)
          province = r.province; city = r.city; county = r.county
        }
        let storedName = file.filename, thumb, full
        if (isVideo) {
          // 视频：转码 720p MP4 + 海报帧（转码产物替换原上传文件）
          const a = await makeVideoAssets(file.filename, file.path)
          storedName = a.video; thumb = a.thumb; full = a.full; duration = a.duration
          try { fs.unlinkSync(file.path) } catch {}
        } else {
          ({ thumb, full } = await makeThumb(file.filename))
        }
        const photo = insertPhoto(db, {
          filename: storedName,
          original_name: file.originalname,
          thumb_path: thumb,
          full_path: full,
          taken_at: takenAt,
          lat, lng, province, city, county,
          location_name: null,
          media_type: isVideo ? 'video' : 'photo',
          duration,
          created_at: new Date().toISOString(),
        })
        results.push(photo)
      } catch (e) {
        await cleanupFile(file)
        results.push({ error: e.message, filename: file.filename })
      }
    }
    res.json({ photos: results })
  })

  router.get('/', (req, res) => {
    const filter = {
      province: req.query.province, city: req.query.city, county: req.query.county,
      orderBy: req.query.orderBy,
      q: req.query.q, from: req.query.from, to: req.query.to,
    }
    // 分页：带 limit 时返回 total，供前端"加载更多"
    if (Number(req.query.limit) > 0) {
      filter.limit = Number(req.query.limit)
      filter.offset = Number(req.query.offset) || 0
      return res.json({ photos: listPhotos(db, filter), total: countPhotos(db, filter) })
    }
    res.json({ photos: listPhotos(db, filter) })
  })

  router.post('/:id/location', (req, res) => {
    const { lat, lng, location_name } = req.body
    let province = null, city = null, county = null
    if (lat != null && lng != null) {
      const r = reverseGeocode(geo, lng, lat)
      province = r.province; city = r.city; county = r.county
    }
    const photo = updateLocation(db, req.params.id, { lat, lng, province, city, county, location_name })
    if (!photo) return res.status(404).json({ error: 'Photo not found' })
    res.json({ photo })
  })

  // 通用元数据更新（拖拽补位置/补时间）：body 可含 province/city/county/taken_at 之一或多个
  router.patch('/:id', (req, res) => {
    const fields = {}
    for (const key of ['province', 'city', 'county', 'taken_at']) {
      if (req.body[key] !== undefined) fields[key] = req.body[key]
    }
    const photo = updatePhotoMeta(db, req.params.id, fields)
    if (!photo) return res.status(404).json({ error: 'Photo not found' })
    res.json({ photo })
  })

  // 永久旋转照片：按累计角度从原始文件旋转，重新生成缩略图与大图
  router.post('/:id/rotate', async (req, res) => {
    const photo = getPhoto(db, req.params.id)
    if (!photo) return res.status(404).json({ error: 'Photo not found' })
    const step = Number(req.body.degrees) || 90
    if (![90, 180, 270].includes(step)) return res.status(400).json({ error: 'degrees must be 90, 180 or 270' })
    const current = Number(photo.rotate_deg) || 0
    const total = (current + step) % 360
    try {
      // 若为 --no-original 导入（filename 是源路径），直接从源路径旋转
      const sourcePath = photo.origin_path && !fs.existsSync(path.join(uploadDir, photo.filename))
        ? photo.origin_path
        : undefined
      await rotatePhoto(photo.filename, total, sourcePath)
      db.prepare('UPDATE photos SET rotate_deg = ? WHERE id = ?').run(total, photo.id)
      res.json({ ok: true, id: photo.id, rotate_deg: total })
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })

  router.delete('/:id', async (req, res) => {
    const photo = deletePhoto(db, req.params.id)
    if (!photo) return res.status(404).json({ error: 'Photo not found' })
    // 删除磁盘文件（原图 + 缩略图 + 大图），尽力而为
    const candidates = [
      path.join(uploadDir, photo.filename),
      photo.thumb_path ? path.join(uploadDir, photo.thumb_path) : null,
      photo.full_path ? path.join(uploadDir, photo.full_path) : null,
    ].filter(Boolean)
    await Promise.all(candidates.map((p) => fs.promises.unlink(p).catch(() => {})))
    res.json({ ok: true, id: photo.id })
  })

  return router
}
