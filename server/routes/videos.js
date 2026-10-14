// 旅行成片：后台内存 job（单进程自托管；重启失效），同一时刻只允许一个渲染任务。
import { Router } from 'express'
import path from 'node:path'
import fs from 'node:fs'
import { EXPORTS_DIR, MUSIC_DIR, UPLOAD_DIR } from '../paths.js'
import { listPhotosByFilenames } from '../db.js'
import { renderVideo, ASPECTS, LENGTHS } from '../video-render.js'

const AUDIO_EXTS = new Set(['.mp3', '.m4a', '.aac', '.wav', '.flac', '.ogg'])

// 照片渲染源：优先原始文件；--no-original 导入的原图不在 uploads（origin_path 在多不在的挂载盘），
// 此时回退到导入时总是生成的 full 大图，避免整张照片被跳过
export function photoMediaPath(row, uploadDir = UPLOAD_DIR) {
  const orig = path.join(uploadDir, row.filename)
  if (fs.existsSync(orig)) return orig
  if (row.full_path) {
    const full = path.join(uploadDir, row.full_path)
    if (fs.existsSync(full)) return full
  }
  return orig
}

// 由 DB 行构造渲染素材描述（mediaPath 供 ffmpeg，imagePath 供择优分析）
function toAsset(row) {
  const mediaPath = row.media_type === 'video'
    ? path.join(UPLOAD_DIR, row.filename)
    : photoMediaPath(row)
  const imagePath = row.media_type === 'video'
    ? path.join(UPLOAD_DIR, row.thumb_path || row.filename)
    : path.join(UPLOAD_DIR, row.full_path || row.filename)
  return {
    id: row.id, filename: row.filename, mediaType: row.media_type,
    takenAt: row.taken_at, duration: row.duration, mediaPath, imagePath,
  }
}

export function videosRouter(db) {
  const r = Router()
  const jobs = new Map()
  let running = null

  function newJob() {
    const id = `video-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const job = { id, kind: 'video', status: 'running', phase: '', processed: 0, total: 0, createdAt: Date.now() }
    jobs.set(id, job)
    pruneJobs()
    return job
  }

  // 控制任务表规模：超过 50 条时从最旧的已完成任务开始清理
  function pruneJobs() {
    if (jobs.size <= 50) return
    const done = [...jobs.values()].filter((j) => j.status !== 'running').sort((a, b) => a.createdAt - b.createdAt)
    for (const j of done) { if (jobs.size <= 50) break; jobs.delete(j.id) }
  }

  // 启动渲染
  r.post('/render', (req, res) => {
    const { fileNames, placeName, aspect, bgm, length } = req.body || {}
    if (!Array.isArray(fileNames) || fileNames.length === 0) return res.status(400).json({ error: '未选择任何素材' })
    if (aspect && !ASPECTS[aspect]) return res.status(400).json({ error: `不支持的画幅: ${aspect}` })
    if (length && !LENGTHS[length]) return res.status(400).json({ error: `不支持的时长档: ${length}` })
    if (bgm) {
      let bgmOk = false
      try { bgmOk = fs.readdirSync(MUSIC_DIR).includes(bgm) && AUDIO_EXTS.has(path.extname(bgm).toLowerCase()) } catch { bgmOk = false }
      if (!bgmOk) return res.status(400).json({ error: `BGM 不存在: ${bgm}` })
    }
    if (running) return res.status(409).json({ error: '已有成片任务进行中', jobId: running })

    const rows = listPhotosByFilenames(db, fileNames)
    if (rows.length === 0) return res.status(400).json({ error: '素材在库中不存在' })

    const job = newJob()
    running = job.id
    job.total = rows.length
    res.json({ jobId: job.id })

    ;(async () => {
      const result = await renderVideo({
        assets: rows.map(toAsset),
        placeName: placeName || '旅行',
        aspect: aspect || '16:9',
        bgm: bgm || null,
        length: length || 'medium',
      }, (phase, processed, total) => { job.phase = phase; job.processed = processed; job.total = total })
      job.name = result.name
      job.status = 'done'
    })().catch((e) => { job.status = 'error'; job.error = e.message })
      .finally(() => { if (running === job.id) running = null })
  })

  // 轮询进度
  r.get('/jobs/:id', (req, res) => {
    const job = jobs.get(req.params.id)
    if (!job) return res.status(404).json({ error: '任务不存在' })
    if (job.status !== 'done') {
      const { id, status, phase, processed, total, error } = job
      return res.json({ id, status, phase, processed, total, error })
    }
    res.json(job)
  })

  // 可用曲目
  r.get('/music', (req, res) => {
    let files = []
    try { files = fs.readdirSync(MUSIC_DIR) } catch { files = [] }
    res.json({ music: files.filter((f) => AUDIO_EXTS.has(path.extname(f).toLowerCase())).sort() })
  })

  // 已生成成片列表
  r.get('/', (req, res) => {
    let files = []
    try { files = fs.readdirSync(EXPORTS_DIR) } catch { files = [] }
    const videos = files.filter((f) => f.toLowerCase().endsWith('.mp4')).map((f) => {
      const st = fs.statSync(path.join(EXPORTS_DIR, f))
      return { name: f, size: st.size, mtime: st.mtimeMs }
    }).sort((a, b) => b.mtime - a.mtime)
    res.json({ videos })
  })

  // 播放/下载（res.sendFile 支持 Range，供 <video> 拖动进度）
  r.get('/:name', (req, res) => {
    const name = path.basename(req.params.name)
    const abs = path.join(EXPORTS_DIR, name)
    if (!abs.startsWith(EXPORTS_DIR) || !fs.existsSync(abs)) return res.status(404).json({ error: '成片不存在' })
    res.sendFile(abs)
  })

  // 删除
  r.delete('/:name', (req, res) => {
    const name = path.basename(req.params.name)
    const abs = path.join(EXPORTS_DIR, name)
    if (!abs.startsWith(EXPORTS_DIR) || !fs.existsSync(abs)) return res.status(404).json({ error: '成片不存在' })
    fs.unlinkSync(abs)
    res.json({ ok: true, name })
  })

  return r
}
