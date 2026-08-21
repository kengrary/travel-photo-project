import { useEffect, useState } from 'react'
import { fetchPhotos, deletePhoto } from '../api.js'
import PhotoGrid from './PhotoGrid.jsx'

export default function PhotoPanel({ filter, photos, label, onClose, onDeleted }) {
  const [loadedPhotos, setLoadedPhotos] = useState(null)
  const [collapsed, setCollapsed] = useState(false)
  const [removedIds, setRemovedIds] = useState(() => new Set())

  // 有显式 photos（聚合点传入）则直接用；否则按 filter 拉取
  useEffect(() => {
    let ignore = false
    if (photos) { setLoadedPhotos(photos); return }
    if (!filter || !filter.province) { setLoadedPhotos(null); return }
    fetchPhotos(filter).then((p) => { if (!ignore) setLoadedPhotos(p) })
    return () => { ignore = true }
  }, [photos, filter?.province, filter?.city, filter?.county])

  const shown = (photos || loadedPhotos || []).filter((p) => !removedIds.has(p.id))
  const place = label || [filter?.province, filter?.city, filter?.county].filter(Boolean).join(' · ')
  const hasPanel = photos || (filter && filter.province)
  if (!hasPanel) return null

  const handleDeleted = (id) => {
    setRemovedIds((s) => new Set(s).add(id))
    setLoadedPhotos((list) => (list ? list.filter((p) => p.id !== id) : list))
    if (onDeleted) onDeleted(id)
  }

  if (collapsed) {
    const shortPlace = place && place.split(' · ').slice(-2).join(' · ')
    const clipped = shortPlace && shortPlace.length > 9 ? shortPlace.slice(0, 9) + '…' : shortPlace
    return (
      <button className="photo-panel-tab" onClick={() => setCollapsed(false)} title={place}>
        <span className="photo-panel-tab-title">照片</span>
        <span className="photo-panel-tab-place">{clipped || '照片'}</span>
        <span className="photo-panel-tab-arrow">◀</span>
      </button>
    )
  }

  return (
    <aside className="photo-panel">
      <div className="photo-panel-head">
        <div className="photo-panel-title">
          <span className="eyebrow">photos</span>
          <strong>{place || '照片'}</strong>
        </div>
        <div className="panel-actions">
          <button className="panel-toggle" onClick={() => setCollapsed(true)} title="折叠">▶</button>
          <button className="panel-close" onClick={onClose} title="关闭">×</button>
        </div>
      </div>
      <div className="photo-panel-body">
        <p className="photo-panel-sub">{shown.length} 张照片</p>
        <PhotoGrid photos={shown} onDelete={deletePhoto} onDeleted={handleDeleted} />
      </div>
    </aside>
  )
}
