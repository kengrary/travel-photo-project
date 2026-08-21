import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { fetchPhotos, deletePhoto, updatePhotoMeta } from '../api.js'
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
  const [params] = useSearchParams()
  const [photos, setPhotos] = useState([])
  const [draggedPhoto, setDraggedPhoto] = useState(null)
  const [dragOverKey, setDragOverKey] = useState(null)
  const [updating, setUpdating] = useState(false)
  const dragCount = useRef(0)

  const filter = {
    province: params.get('province') || undefined,
    city: params.get('city') || undefined,
    county: params.get('county') || undefined,
  }

  useEffect(() => {
    let ignore = false
    fetchPhotos(filter).then((p) => { if (!ignore) setPhotos(p) })
    return () => { ignore = true }
  }, [params.toString()])

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

  // 判断能否落在此目标（补位置或补时间）
  const canDropHere = (target) => {
    if (!draggedPhoto) return false
    if (target.type === 'location') return !draggedPhoto.province
    if (target.type === 'time') return !monthKey(draggedPhoto.taken_at)
    return false
  }

  const handleDrop = async (e, target) => {
    e.preventDefault()
    dragCount.current = 0
    setDragOverKey(null)
    const p = draggedPhoto
    setDraggedPhoto(null)
    if (!p || !canDropHere(target)) return
    setUpdating(true)
    try {
      let fields = {}
      if (target.type === 'location') fields = { province: target.province, city: target.city, county: target.county }
      if (target.type === 'time') fields = { taken_at: monthValue(target.key) }
      const updated = await updatePhotoMeta(p.id, fields)
      // 更新本地列表，让照片移动到正确分组
      setPhotos((list) => list.map((x) => (x.id === p.id ? { ...x, ...updated } : x)))
    } catch (err) {
      alert(`更新失败：${err.message}`)
    } finally {
      setUpdating(false)
    }
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

      {photos.length === 0 ? (
        <div className="empty">
          <div className="empty-title">这里还没有照片</div>
          <p>上传几张带位置的旅行照片，它们就会出现在这里。</p>
        </div>
      ) : (
        <div className="wall-groups">
          {groups.map((g) => {
            const locTarget = { type: 'location', key: g.label, province: g.province, city: g.city, county: g.county }
            const locDroppable = canDropHere(locTarget)
            return (
              <section
                key={g.label}
                className={`wall-group${locDroppable ? ' droppable' : ''}${dragOverKey === g.label ? ' drag-over' : ''}`}
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
                  const timeDroppable = canDropHere(timeTarget)
                  return (
                    <section
                      key={sub.key}
                      className={`wall-subgroup${timeDroppable ? ' droppable' : ''}${dragOverKey === sub.key ? ' drag-over' : ''}`}
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
                        onPhotoDragStart={handleDragStart}
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
    </div>
  )
}
