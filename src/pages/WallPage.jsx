import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { fetchPhotosPaged, deletePhoto, updatePhotoMeta } from '../api.js'
import PhotoGrid from '../components/PhotoGrid.jsx'

function monthKey(t) {
  if (!t) return null
  const d = new Date(t)
  if (isNaN(d)) return null
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function monthLabel(t) {
  const d = new Date(t)
  return `${d.getFullYear()}年${d.getMonth() + 1}月`
}
function monthValue(key) {
  const [y, m] = key.split('-').map(Number)
  return `${y}-${String(m).padStart(2, '0')}-01T12:00:00Z`
}

// 统计列表里的视频数量
const countVideos = (list) => list.reduce((n, p) => n + (p.media_type === 'video' ? 1 : 0), 0)

export default function WallPage() {
  const [params, setParams] = useSearchParams()
  const [photos, setPhotos] = useState([])
  const [draggedPhoto, setDraggedPhoto] = useState(null)
  const [dragOverKey, setDragOverKey] = useState(null)
  const [updating, setUpdating] = useState(false)
  const dragCount = useRef(0)
  // 点击式移动（手机端补位）：待移动的照片
  const [movingPhoto, setMovingPhoto] = useState(null)
  // 批量管理模式
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState(() => new Set())

  // 筛选输入（本地状态，防抖同步到 URL 参数）
  const [searchText, setSearchText] = useState(params.get('q') || '')
  const [fromDate, setFromDate] = useState(params.get('from') || '')
  const [toDate, setToDate] = useState(params.get('to') || '')
  const [total, setTotal] = useState(0)
  const PAGE_SIZE = 300

  const filter = {
    province: params.get('province') || undefined,
    city: params.get('city') || undefined,
    county: params.get('county') || undefined,
    q: params.get('q') || undefined,
    from: params.get('from') || undefined,
    to: params.get('to') || undefined,
  }
  const hasFilters = Boolean(filter.q || filter.from || filter.to)

  useEffect(() => {
    const t = setTimeout(() => {
      const next = new URLSearchParams(params)
      for (const [k, v] of [['q', searchText.trim()], ['from', fromDate], ['to', toDate]]) {
        if (v) next.set(k, v)
        else next.delete(k)
      }
      if (next.toString() !== params.toString()) setParams(next)
    }, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchText, fromDate, toDate])

  const clearFilters = () => {
    setSearchText('')
    setFromDate('')
    setToDate('')
  }

  useEffect(() => {
    let ignore = false
    setTotal(0)
    fetchPhotosPaged(filter, PAGE_SIZE, 0).then((d) => {
      if (!ignore) { setPhotos(d.photos); setTotal(d.total) }
    })
    return () => { ignore = true }
  }, [params.toString()])

  // 加载更多（分页渐进加载）
  const loadMore = async () => {
    const d = await fetchPhotosPaged(filter, PAGE_SIZE, photos.length)
    setPhotos((list) => [...list, ...d.photos])
    setTotal(d.total)
  }

  // 位置 → 时间 二级嵌套分组
  const groups = useMemo(() => {
    // 按位置分组
    const locMap = new Map()
    for (const p of photos) {
      const key = [p.province, p.city, p.county].filter(Boolean).join(' · ') || '未知位置'
      if (!locMap.has(key)) locMap.set(key, { label: key, province: p.province || null, city: p.city || null, county: p.county || null, photos: [] })
      locMap.get(key).photos.push(p)
    }
    const result = []
    for (const loc of locMap.values()) {
      // 组内按时间分
      const timeMap = new Map()
      const unknownTime = []
      for (const p of loc.photos) {
        const k = monthKey(p.taken_at)
        if (!k) { unknownTime.push(p); continue }
        if (!timeMap.has(k)) timeMap.set(k, [])
        timeMap.get(k).push(p)
      }
      const sub = []
      const keys = [...timeMap.keys()].sort().reverse()
      for (const k of keys) {
        const list = timeMap.get(k)
        sub.push({ key: k, label: monthLabel(list[0].taken_at), photos: list })
      }
      if (unknownTime.length) sub.push({ key: 'unknown', label: '未填写时间', photos: unknownTime })
      result.push({ ...loc, sub })
    }
    return result
  }, [photos])

  const place = [filter.province, filter.city, filter.county].filter(Boolean).join(' · ')
  const title = place || '全部照片'

  const handleDeleted = (id) => setPhotos((list) => list.filter((p) => p.id !== id))

  // ---- 拖拽 ----
  const handleDragStart = (e, photo) => {
    setDraggedPhoto(photo)
    e.dataTransfer.effectAllowed = 'move'
    if (e.dataTransfer.setData) e.dataTransfer.setData('text/plain', String(photo.id))
  }

  const handleDragEnter = (e, key) => {
    e.preventDefault()
    dragCount.current += 1
    setDragOverKey(key)
  }
  const handleDragLeave = (e, key) => {
    dragCount.current -= 1
    if (dragCount.current <= 0) { dragCount.current = 0; setDragOverKey((cur) => (cur === key ? null : cur)) }
  }
  const handleDragOver = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }

  // 判断某张照片能否落到此目标（补位置或补时间）
  const moveAllowed = (target, p) => {
    if (!target || !p) return false
    if (target.type === 'location') return !p.province
    if (target.type === 'time') return !monthKey(p.taken_at)
    return false
  }
  // 拖拽中 或 点击移动中的照片
  const activeMoving = draggedPhoto || movingPhoto

  const applyMove = async (target, photo) => {
    const p = photo || movingPhoto
    if (!moveAllowed(target, p)) return
    setUpdating(true)
    try {
      let fields = {}
      if (target.type === 'location') fields = { province: target.province, city: target.city, county: target.county }
      if (target.type === 'time') fields = { taken_at: monthValue(target.key) }
      const updated = await updatePhotoMeta(p.id, fields)
      // 更新本地列表，让照片移动到正确分组
      setPhotos((list) => list.map((x) => (x.id === p.id ? { ...x, ...updated } : x)))
      setMovingPhoto(null)
    } catch (err) {
      alert(`更新失败：${err.message}`)
    } finally {
      setUpdating(false)
    }
  }

  const handleDrop = async (e, target) => {
    e.preventDefault()
    dragCount.current = 0
    setDragOverKey(null)
    const p = draggedPhoto
    setDraggedPhoto(null)
    if (!p) return
    await applyMove(target, p)
  }

  // ---- 批量管理 ----
  const toggleSelect = (photo) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(photo.id)) next.delete(photo.id)
      else next.add(photo.id)
      return next
    })
  }

  const exitSelectMode = () => { setSelectMode(false); setSelectedIds(new Set()) }

  const handleBatchDelete = async () => {
    if (!selectedIds.size) return
    if (!window.confirm(`确定删除所选的 ${selectedIds.size} 张照片吗？此操作不可恢复。`)) return
    setUpdating(true)
    const ids = [...selectedIds]
    const results = await Promise.allSettled(ids.map((id) => deletePhoto(id)))
    const failed = ids.filter((_, i) => results[i].status === 'rejected')
    const done = ids.filter((_, i) => results[i].status === 'fulfilled')
    setPhotos((list) => list.filter((x) => !done.includes(x.id))) // 仅移除成功的，失败的保留
    setSelectedIds(new Set(failed))
    setUpdating(false)
    if (failed.length) alert(`${failed.length} 张删除失败，请重试`)
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">photo log · {place || '全部'}</div>
          <h1 className="page-title">{title}</h1>
          <p className="page-sub">
            {photos.length} 张照片{place ? ` · 拍摄于 ${place}` : ''}
            {!place && <span style={{ fontWeight: 'normal', color: 'var(--ink-soft)' }}> · 按位置分组，未填写位置/时间的可拖拽到对应分组补充</span>}
          </p>
        </div>
      </div>

      <div className="wall-filters">
        <input
          className="wall-filter-input"
          placeholder="搜索地点或文件名…"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
        />
        <span className="wall-filter-dates">
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} aria-label="开始日期" />
          <span className="wall-filter-sep">~</span>
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} aria-label="结束日期" />
        </span>
        {hasFilters && (
          <button className="btn btn-ghost" onClick={clearFilters}>清除筛选</button>
        )}
        <span style={{ flex: 1 }} />
        {!selectMode && photos.length > 0 && (
          <button className="btn btn-ghost" onClick={() => setSelectMode(true)}>批量管理</button>
        )}
        {selectMode && (
          <>
            <span className="wall-group-sub">已选 {selectedIds.size} 张</span>
            <button className="btn btn-delete" disabled={selectedIds.size === 0} onClick={handleBatchDelete}>删除所选</button>
            <button className="btn btn-ghost" onClick={exitSelectMode}>退出批量</button>
          </>
        )}
      </div>

      {movingPhoto && (
        <div className="move-banner">
          <span>
            正在移动「<b>{movingPhoto.original_name}</b>」— 点击高亮的分组完成{!movingPhoto.province ? '归位' : '补时间'}
            {(!movingPhoto.province && !monthKey(movingPhoto.taken_at)) ? '（位置或时间任选其一）' : ''}
          </span>
          <button className="btn btn-ghost" onClick={() => setMovingPhoto(null)}>取消移动</button>
        </div>
      )}

      {photos.length === 0 ? (
        <div className="empty">
          <div className="empty-title">这里还没有照片</div>
          <p>上传几张带位置的旅行照片，它们就会出现在这里。</p>
        </div>
      ) : (
        <div className="wall-groups">
          {groups.map((g) => {
            const locTarget = { type: 'location', key: g.label, province: g.province, city: g.city, county: g.county }
            const locDroppable = moveAllowed(locTarget, activeMoving)
            return (
              <section
                key={g.label}
                className={`wall-group${locDroppable ? ' droppable' : ''}${dragOverKey === g.label ? ' drag-over' : ''}`}
                onClick={() => { if (moveAllowed(locTarget, movingPhoto)) applyMove(locTarget) }}
                onDragEnter={(e) => handleDragEnter(e, g.label)}
                onDragLeave={(e) => handleDragLeave(e, g.label)}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, locTarget)}
              >
                <header className="wall-group-head">
                  <h2 className="wall-group-title">{g.label}</h2>
                  <span className="wall-group-sub">
                    {g.photos.length} 张照片{countVideos(g.photos) > 0 ? ` · ${countVideos(g.photos)} 个视频` : ''}{locDroppable && !g.province ? ' · 可拖入照片补充位置' : ''}
                  </span>
                </header>
                {g.sub.map((sub) => {
                  const timeTarget = { type: 'time', key: sub.key, label: sub.label }
                  const timeDroppable = moveAllowed(timeTarget, activeMoving)
                  return (
                    <section
                      key={sub.key}
                      className={`wall-subgroup${timeDroppable ? ' droppable' : ''}${dragOverKey === sub.key ? ' drag-over' : ''}`}
                      onClick={(e) => {
                        if (moveAllowed(timeTarget, movingPhoto)) { e.stopPropagation(); applyMove(timeTarget) }
                      }}
                      onDragEnter={(e) => handleDragEnter(e, sub.key)}
                      onDragLeave={(e) => handleDragLeave(e, sub.key)}
                      onDragOver={handleDragOver}
                      onDrop={(e) => handleDrop(e, timeTarget)}
                    >
                      <h3 className="wall-subgroup-title">
                        {sub.label}
                        <span className="wall-group-sub"> {sub.photos.length} 张{countVideos(sub.photos) > 0 ? ` · ${countVideos(sub.photos)} 视频` : ''}</span>
                      </h3>
                      <PhotoGrid
                        photos={sub.photos}
                        onDelete={deletePhoto}
                        onDeleted={handleDeleted}
                        onPhotoDragStart={selectMode ? undefined : handleDragStart}
                        selectMode={selectMode}
                        selectedIds={selectedIds}
                        onToggleSelect={toggleSelect}
                        onMove={setMovingPhoto}
                      />
                    </section>
                  )
                })}
              </section>
            )
          })}
          {updating && <p className="wall-group-sub" style={{ marginTop: 12 }}>更新中…</p>}
        </div>
      )}

      {photos.length < total && (
        <div style={{ textAlign: 'center', margin: '18px 0 30px' }}>
          <button className="btn btn-ghost" onClick={loadMore}>
            加载更多（已显示 {photos.length} / 共 {total} 张）
          </button>
        </div>
      )}
    </div>
  )
}
