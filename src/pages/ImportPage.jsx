import { useEffect, useMemo, useRef, useState } from 'react'
import { scanImport, getImportJob, startImport } from '../api.js'

function fmtSize(n) {
  if (!n) return '0'
  if (n > 2 ** 30) return (n / 2 ** 30).toFixed(1) + ' GB'
  if (n > 2 ** 20) return (n / 2 ** 20).toFixed(0) + ' MB'
  return Math.max(1, Math.round(n / 2 ** 10)) + ' KB'
}

function fmtDate(t) {
  if (!t) return '无时间'
  const d = new Date(t)
  return isNaN(d) ? '无时间' : d.toLocaleDateString('zh-CN')
}

// 每组最多渲染的明细行数（避免万级 DOM）
const ROW_LIMIT_PER_GROUP = 200

export default function ImportPage() {
  const [step, setStep] = useState('input') // input | scanning | stats | importing | done
  const [scanPath, setScanPath] = useState('')
  const [progress, setProgress] = useState(null) // { phase, processed, total }
  const [items, setItems] = useState([])
  const [summary, setSummary] = useState(null)
  const [selected, setSelected] = useState(() => new Set())
  const [noOriginal, setNoOriginal] = useState(false)
  const [keepRes, setKeepRes] = useState(false)
  const [hideDup, setHideDup] = useState(true)
  const [monthFilter, setMonthFilter] = useState('')
  const [extFilter, setExtFilter] = useState('')
  const [result, setResult] = useState(null)
  const timerRef = useRef(null)
  const lastScanJobId = useRef(null)

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current) }, [])

  const pollJob = (jobId, onDone) => {
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = setInterval(async () => {
      try {
        const j = await getImportJob(jobId)
        if (j.status === 'running') { setProgress({ phase: j.phase, processed: j.processed, total: j.total }); return }
        clearInterval(timerRef.current)
        if (j.status === 'error') { alert(`任务失败：${j.error}`); setStep('input'); return }
        onDone(j)
      } catch (e) {
        clearInterval(timerRef.current)
        alert(`轮询失败：${e.message}`)
        setStep('input')
      }
    }, 700)
  }

  const beginScan = async () => {
    if (!scanPath.trim()) return
    try {
      const { jobId } = await scanImport(scanPath.trim())
      lastScanJobId.current = jobId
      setStep('scanning')
      setProgress({ phase: 'collect', processed: 0, total: 0 })
      pollJob(jobId, (j) => {
        setItems(j.items || [])
        setSummary(j.summary)
        setSelected(new Set())
        setMonthFilter(''); setExtFilter('')
        setStep('stats')
      })
    } catch (e) {
      alert(`扫描启动失败：${e.message}`)
    }
  }

  // 参与统计/选择的条目（排除读取失败项）
  const validItems = useMemo(() => items.filter((it) => !it.error), [items])

  // 列表可见条目：应用月份/格式筛选与"隐藏已导入"
  const visibleItems = useMemo(() => validItems.filter((it) => {
    if (hideDup && it.duplicate) return false
    if (monthFilter && String(it.takenAt || '').slice(0, 7) !== monthFilter) return false
    if (extFilter && (path_ext(it.fileName) !== extFilter)) return false
    return true
  }), [validItems, hideDup, monthFilter, extFilter])

  // 按 省·市 分组（保持 summary 的键风格）
  const groups = useMemo(() => {
    const m = new Map()
    for (const it of visibleItems) {
      const key = [it.province || '未知位置', it.city].filter(Boolean).join(' · ')
      if (!m.has(key)) m.set(key, [])
      m.get(key).push(it)
    }
    return [...m.entries()].map(([key, list]) => ({
      key,
      list,
      bytes: list.reduce((n, it) => n + (it.sizeBytes || 0), 0),
    })).sort((a, b) => b.list.length - a.list.length)
  }, [visibleItems])

  const selectedBytes = useMemo(() => {
    let n = 0
    for (const it of validItems) if (selected.has(it.filePath)) n += it.sizeBytes || 0
    return n
  }, [validItems, selected])

  const togglePaths = (paths) => {
    setSelected((prev) => {
      const next = new Set(prev)
      const allIn = paths.every((p) => next.has(p))
      for (const p of paths) allIn ? next.delete(p) : next.add(p)
      return next
    })
  }

  const selectAllVisible = () => togglePaths(visibleItems.map((it) => it.filePath))
  const clearSelection = () => setSelected(new Set())

  const beginImport = async () => {
    if (!lastScanJobId.current || selected.size === 0) return
    try {
      const { jobId } = await startImport({
        jobId: lastScanJobId.current,
        originPaths: [...selected],
        noOriginal,
        keepOriginalResolution: keepRes,
      })
      setStep('importing')
      setResult(null)
      setProgress({ phase: 'commit', processed: 0, total: selected.size })
      pollJob(jobId, (j) => { setResult(j.result); setStep('done') })
    } catch (e) {
      alert(`导入启动失败：${e.message}`)
    }
  }

  const reset = () => { setStep('input'); setItems([]); setSummary(null); setSelected(new Set()); setResult(null) }

  const months = useMemo(() => [...new Set(validItems.map((it) => String(it.takenAt || '').slice(0, 7)).filter((m) => /^\d{4}-\d{2}$/.test(m)))].sort().reverse(), [validItems])
  const exts = useMemo(() => {
    const m = new Map()
    for (const it of validItems) { const e = path_ext(it.fileName); if (e) m.set(e, (m.get(e) || 0) + 1) }
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [validItems])

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">bulk import · server path</div>
          <h1 className="page-title">批量导入</h1>
          <p className="page-sub">输入照片所在的服务器目录（如 NAS / 移动硬盘挂载路径），先扫描统计，再勾选需要导入的部分。文件不经过浏览器上传。</p>
        </div>
      </div>

      {(step === 'input' || step === 'scanning') && (
        <>
          <div className="wall-filters">
            <input
              className="wall-filter-input"
              style={{ minWidth: 360 }}
              placeholder="/mnt/nas/photos …"
              value={scanPath}
              onChange={(e) => setScanPath(e.target.value)}
              disabled={step === 'scanning'}
              onKeyDown={(e) => { if (e.key === 'Enter') beginScan() }}
            />
            <button className="btn btn-primary" onClick={beginScan} disabled={step === 'scanning' || !scanPath.trim()}>
              {step === 'scanning' ? '扫描中…' : '开始扫描'}
            </button>
          </div>
          {step === 'scanning' && progress && (
            <div className="import-progress">
              <p>{progress.phase === 'collect' ? `正在递归收集文件… 已发现 ${progress.processed} 个` : `读取元数据 ${progress.processed}/${progress.total}`}</p>
              <div className="bar"><span style={{ width: progress.total ? `${(progress.processed / progress.total) * 100}%` : '30%' }} /></div>
            </div>
          )}
        </>
      )}

      {step === 'stats' && summary && (
        <>
          <div className="import-stats">
            <div className="stat-chip"><b>{summary.fresh}</b><span>新条目</span></div>
            <div className="stat-chip"><b>{summary.photos}</b><span>照片</span></div>
            <div className="stat-chip"><b>{summary.videos}</b><span>视频</span></div>
            <div className="stat-chip"><b>{fmtSize(summary.totalBytes)}</b><span>总大小</span></div>
            <div className="stat-chip warn"><b>{summary.noGps}</b><span>无GPS</span></div>
            {summary.duplicates > 0 && <div className="stat-chip muted"><b>{summary.duplicates}</b><span>已导入过</span></div>}
            {summary.errors > 0 && <div className="stat-chip warn"><b>{summary.errors}</b><span>读取失败</span></div>}
          </div>

          <div className="wall-filters">
            <select value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)} className="wall-filter-input">
              <option value="">全部月份</option>
              {months.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <select value={extFilter} onChange={(e) => setExtFilter(e.target.value)} className="wall-filter-input">
              <option value="">全部格式</option>
              {exts.map(([e, n]) => <option key={e} value={e}>{e} ({n})</option>)}
            </select>
            <label className="import-check"><input type="checkbox" checked={hideDup} onChange={(e) => setHideDup(e.target.checked)} /> 隐藏已导入</label>
            <button className="btn btn-ghost" onClick={selectAllVisible}>全选当前列表</button>
            <button className="btn btn-ghost" onClick={clearSelection}>清空选择</button>
          </div>

          <div className="import-provinces">
            {Object.entries(summary.provinces).sort((a, b) => b[1].count - a[1].count).map(([key, v]) => (
              <button key={key} className="province-card" onClick={() => togglePaths(visibleItems.filter((it) => ([it.province || '未知位置', it.city].filter(Boolean).join(' · ')) === key).map((it) => it.filePath))}>
                <b>{key}</b>
                <span>{v.count} 张 · {fmtSize(v.bytes)}</span>
              </button>
            ))}
          </div>

          <div className="import-list">
            {groups.length === 0 && <div className="empty"><div className="empty-title">没有符合条件的文件</div></div>}
            {groups.map((g) => {
              const shown = g.list.slice(0, ROW_LIMIT_PER_GROUP)
              return (
                <details key={g.key} open className="import-group">
                  <summary>
                    <b>{g.key}</b>
                    <span className="wall-group-sub"> {g.list.length} 项 · {fmtSize(g.bytes)}</span>
                    <button className="btn btn-ghost group-toggle" onClick={(e) => { e.preventDefault(); togglePaths(g.list.map((it) => it.filePath)) }}>整组勾选</button>
                  </summary>
                  {shown.map((it) => (
                    <label key={it.filePath} className={`import-row${it.duplicate ? ' dup' : ''}${it.error ? ' err' : ''}`}>
                      <input
                        type="checkbox"
                        checked={selected.has(it.filePath)}
                        onChange={() => togglePaths([it.filePath])}
                      />
                      <span className="import-row-name">{it.fileName}{it.duplicate && <em className="tag-dup">已导入</em>}{it.error && <em className="tag-err">{it.error}</em>}</span>
                      <span className="import-row-meta">
                        {[it.province, it.city, it.county].filter(Boolean).join(' ') || '无位置'} · {fmtDate(it.takenAt)} · {fmtSize(it.sizeBytes)}
                        {it.mediaType === 'video' && it.duration ? ` · ${Math.round(it.duration)}s` : ''}
                      </span>
                    </label>
                  ))}
                  {g.list.length > shown.length && (
                    <p className="wall-group-sub" style={{ padding: '6px 14px' }}>还有 {g.list.length - shown.length} 项未显示，请用筛选缩小范围</p>
                  )}
                </details>
              )
            })}
          </div>

          <div className="import-actionbar">
            <span>已选 <b>{selected.size}</b> 张 · 约 <b>{fmtSize(selectedBytes)}</b></span>
            <label className="import-check"><input type="checkbox" checked={noOriginal} onChange={(e) => setNoOriginal(e.target.checked)} /> 不复制原图（仅缩略图+大图，省空间）</label>
            <label className="import-check" title="默认转码为 720p 以节省空间；保持原分辨率画质更佳但文件明显更大">
              <input type="checkbox" checked={keepRes} onChange={(e) => setKeepRes(e.target.checked)} /> 视频保持原分辨率
            </label>
            <button className="btn btn-primary" disabled={selected.size === 0} onClick={beginImport}>开始导入</button>
            <button className="btn btn-ghost" onClick={reset}>重新扫描</button>
          </div>
        </>
      )}

      {step === 'importing' && progress && (
        <div className="import-progress">
          <p>正在导入 {progress.processed}/{progress.total}（视频转码较慢，请耐心等待）</p>
          <div className="bar"><span style={{ width: `${progress.processed * 100 / Math.max(1, progress.total)}%` }} /></div>
        </div>
      )}

      {step === 'done' && result && (
        <div className="empty">
          <div className="empty-title">导入完成</div>
          <p>成功 {result.ok} · 跳过(重复) {result.skipped} · 失败 {result.failed}</p>
          {result.failures?.length > 0 && (
            <ul style={{ textAlign: 'left', display: 'inline-block', color: 'var(--ink-soft)' }}>
              {result.failures.slice(0, 10).map((f, i) => <li key={i}>{f.fileName}: {f.error}</li>)}
            </ul>
          )}
          <div style={{ marginTop: 16 }}>
            <button className="btn btn-primary" onClick={reset}>再导一批</button>
          </div>
        </div>
      )}
    </div>
  )
}

function path_ext(name) {
  const i = String(name || '').lastIndexOf('.')
  return i < 0 ? '' : name.slice(i + 1).toLowerCase()
}
