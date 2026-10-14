import { useEffect, useRef, useState } from 'react'
import { listMusic, renderVideo, getVideoJob, videoUrl } from '../api.js'

// 素材筛选 + 参数 + 进度 + 预览。photos: 该地点全部照片/视频（含 id/filename/thumb_path/media_type）
export default function VideoDialog({ photos, placeName, onClose }) {
  const [selected, setSelected] = useState(() => new Set(photos.map((p) => p.id)))
  const [aspect, setAspect] = useState('16:9')
  const [length, setLength] = useState('medium')
  const [music, setMusic] = useState([])
  const [bgm, setBgm] = useState('')
  const [phase, setPhase] = useState('setup') // setup | running | done | error
  const [progress, setProgress] = useState({ phase: '', processed: 0, total: 0 })
  const [output, setOutput] = useState(null)
  const [error, setError] = useState('')
  const timerRef = useRef(null)

  useEffect(() => { listMusic().then(setMusic).catch(() => {}) }, [])
  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current) }, [])

  const toggle = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const allIds = photos.map((p) => p.id)
  const selectAll = () => setSelected(new Set(allIds))
  const invert = () => setSelected((s) => new Set(allIds.filter((id) => !s.has(id))))

  const generate = async () => {
    if (selected.size === 0) return
    setPhase('running'); setError('')
    try {
      const fileNames = photos.filter((p) => selected.has(p.id)).map((p) => p.filename)
      const { jobId } = await renderVideo({ fileNames, placeName, aspect, bgm: bgm || null, length })
      timerRef.current = setInterval(async () => {
        try {
          const j = await getVideoJob(jobId)
          if (j.status === 'running') { setProgress({ phase: j.phase, processed: j.processed, total: j.total }); return }
          clearInterval(timerRef.current)
          if (j.status === 'error') { setError(j.error || '渲染失败'); setPhase('error'); return }
          setOutput(j.name); setPhase('done')
        } catch (e) {
          clearInterval(timerRef.current); setError(e.message); setPhase('error')
        }
      }, 800)
    } catch (e) {
      setError(e.message); setPhase('error')
    }
  }

  const pct = progress.total ? Math.round((progress.processed / progress.total) * 100) : 0

  return (
    <div className="video-dialog-backdrop" onClick={onClose}>
      <div className="video-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="video-dialog-head">
          <strong>生成旅行视频 · {placeName}</strong>
          <button className="panel-close" onClick={onClose} title="关闭">×</button>
        </div>

        {phase === 'setup' && (
          <>
            <div className="video-dialog-toolbar">
              <span>已选 {selected.size}/{photos.length}</span>
              <button className="btn btn-ghost" onClick={selectAll}>全选</button>
              <button className="btn btn-ghost" onClick={() => setSelected(new Set())}>清空</button>
              <button className="btn btn-ghost" onClick={invert}>反选</button>
            </div>
            <div className="video-dialog-grid">
              {photos.map((p) => (
                <div
                  key={p.id}
                  className={`video-dialog-item${selected.has(p.id) ? ' on' : ''}`}
                  onClick={() => toggle(p.id)}
                >
                  {p.media_type === 'video'
                    ? <video src={`/uploads/${p.filename}`} poster={`/uploads/${p.thumb_path}`} muted preload="metadata" />
                    : <img src={`/uploads/${p.thumb_path}`} alt={p.original_name} loading="lazy" />}
                  <span className="video-dialog-check">{selected.has(p.id) ? '✓' : ''}</span>
                </div>
              ))}
            </div>
            <div className="video-dialog-controls">
              <label>画幅
                <select value={aspect} onChange={(e) => setAspect(e.target.value)}>
                  <option value="16:9">横屏 16:9</option>
                  <option value="9:16">竖屏 9:16</option>
                </select>
              </label>
              <label>时长
                <select value={length} onChange={(e) => setLength(e.target.value)}>
                  <option value="short">短 ≈30s</option>
                  <option value="medium">中 ≈60s</option>
                  <option value="long">长 ≈120s</option>
                </select>
              </label>
              <label>背景音乐
                <select value={bgm} onChange={(e) => setBgm(e.target.value)}>
                  <option value="">无</option>
                  {music.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </label>
            </div>
            <div className="video-dialog-actions">
              <button className="btn btn-primary" disabled={selected.size === 0} onClick={generate}>开始生成</button>
            </div>
          </>
        )}

        {phase === 'running' && (
          <div className="import-progress">
            <p>{progress.phase === 'analyze' ? '正在分析素材…' : progress.phase === 'compose' ? '正在合成…' : `正在渲染 ${progress.processed}/${progress.total}`}</p>
            <div className="bar"><span style={{ width: `${pct}%` }} /></div>
          </div>
        )}

        {phase === 'done' && output && (
          <div className="video-dialog-result">
            <video src={videoUrl(output)} controls autoPlay style={{ width: '100%', borderRadius: 8 }} />
            <div className="video-dialog-actions">
              <a className="btn btn-primary" href={videoUrl(output)} download={output}>下载</a>
              <button className="btn btn-ghost" onClick={onClose}>完成</button>
            </div>
          </div>
        )}

        {phase === 'error' && (
          <div className="empty">
            <div className="empty-title">生成失败</div>
            <p>{error}</p>
            <button className="btn btn-primary" onClick={() => setPhase('setup')}>返回</button>
          </div>
        )}
      </div>
    </div>
  )
}
