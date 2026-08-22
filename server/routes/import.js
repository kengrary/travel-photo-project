// 网页批量导入：服务器路径扫描 → 统计 → 选择 → 后台导入
// 任务存内存（单进程自托管应用；服务重启后任务失效）
import { Router } from 'express'
import path from 'node:path'
import fs from 'node:fs'
import { collectMediaFiles, prepareItem, commitItem } from '../import-core.js'

const jobs = new Map()
let running = { scan: null, import: null }

function newJob(kind) {
  const id = `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const job = { id, kind, status: 'running', phase: '', processed: 0, total: 0, createdAt: Date.now() }
  jobs.set(id, job)
  return job
}

// 汇总统计：按"省·市"聚合数量/体积，按月计数，按扩展名计数
// duplicate/error 单列，不计入内容维度
function buildSummary(items) {
  const s = {
    total: items.length, fresh: 0, duplicates: 0, errors: 0,
    photos: 0, videos: 0, noGps: 0, totalBytes: 0,
    provinces: {}, months: {}, exts: {},
  }
  for (const it of items) {
    if (it.error) { s.errors++; continue }
    if (it.duplicate) { s.duplicates++; continue }
    s.fresh++
    s.totalBytes += it.sizeBytes || 0
    if (it.mediaType === 'video') s.videos++; else s.photos++
    if (it.lat == null) s.noGps++
    const key = [it.province || '未知位置', it.city].filter(Boolean).join(' · ')
    s.provinces[key] = s.provinces[key] || { count: 0, bytes: 0 }
    s.provinces[key].count++
    s.provinces[key].bytes += it.sizeBytes || 0
    if (it.takenAt) {
      const m = String(it.takenAt).slice(0, 7)
      s.months[m] = (s.months[m] || 0) + 1
    }
    const ext = path.extname(it.fileName || '').replace('.', '').toLowerCase() || '其他'
    s.exts[ext] = (s.exts[ext] || 0) + 1
  }
  return s
}

export function importRouter(db, geo) {
  const r = Router()

  // 创建扫描任务：递归收集文件 → 逐个读元数据+定位+查重
  r.post('/scan', (req, res) => {
    const raw = req.body?.path
    if (!raw || typeof raw !== 'string') return res.status(400).json({ error: '缺少 path' })
    const abs = path.resolve(raw)
    let isDir = false
    try { isDir = fs.existsSync(abs) && fs.statSync(abs).isDirectory() } catch {}
    if (!isDir) return res.status(400).json({ error: `目录不存在或不是目录: ${abs}` })
    if (running.scan) return res.status(409).json({ error: '已有扫描任务进行中', jobId: running.scan })

    const job = newJob('scan')
    running.scan = job.id
    res.json({ jobId: job.id })

    ;(async () => {
      job.phase = 'collect'
      const files = collectMediaFiles(abs)
      job.total = files.length
      job.phase = 'meta'
      const items = []
      for (const f of files) {
        try {
          const item = await prepareItem(db, geo, f, { keepDuplicates: true })
          if (item) items.push(item)
        } catch (e) {
          items.push({ filePath: f, fileName: path.basename(f), error: e.message })
        }
        job.processed++
      }
      job.items = items
      job.summary = buildSummary(items)
      job.status = 'done'
    })().catch((e) => { job.status = 'error'; job.error = e.message })
      .finally(() => { if (running.scan === job.id) running.scan = null })
  })

  // 启动导入任务：只导用户勾选的 originPaths
  r.post('/start', (req, res) => {
    const { jobId, originPaths, noOriginal = false, keepOriginalResolution = false } = req.body || {}
    const scan = jobs.get(jobId)
    if (!scan || scan.kind !== 'scan' || scan.status !== 'done' || !Array.isArray(scan.items)) {
      return res.status(400).json({ error: '扫描任务不存在或未完成' })
    }
    if (!Array.isArray(originPaths) || originPaths.length === 0) {
      return res.status(400).json({ error: '未选择要导入的文件' })
    }
    if (running.import) return res.status(409).json({ error: '已有导入任务进行中', jobId: running.import })

    const byPath = new Map(scan.items.map((it) => [it.filePath, it]))
    const selected = originPaths.map((p) => byPath.get(p)).filter(Boolean)

    const job = newJob('import')
    running.import = job.id
    job.total = selected.length
    job.phase = 'commit'
    res.json({ jobId: job.id })

    ;(async () => {
      let ok = 0, skipped = 0
      const failures = []
      for (const it of selected) {
        try {
          const photo = await commitItem(db, it, { noOriginal, keepOriginalResolution })
          photo ? ok++ : skipped++
        } catch (e) {
          failures.push({ filePath: it.filePath, fileName: it.fileName, error: e.message })
        }
        job.processed++
      }
      job.result = { ok, skipped, failed: failures.length, failures }
      job.status = 'done'
    })().catch((e) => { job.status = 'error'; job.error = e.message })
      .finally(() => { if (running.import === job.id) running.import = null })
  })

  // 轮询进度；完成后返回全量结果
  r.get('/jobs/:id', (req, res) => {
    const job = jobs.get(req.params.id)
    if (!job) return res.status(404).json({ error: '任务不存在' })
    if (job.status !== 'done') {
      const { id, kind, status, phase, processed, total, error } = job
      return res.json({ id, kind, status, phase, processed, total, error })
    }
    res.json(job)
  })

  return r
}
