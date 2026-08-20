import { useEffect, useState } from 'react'
import { fetchPhotos } from '../api.js'
import PhotoGrid from './PhotoGrid.jsx'

export default function PhotoPanel({ filter, onClose }) {
  const [photos, setPhotos] = useState([])
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    let ignore = false
    if (!filter || !filter.province) { setPhotos([]); return }
    fetchPhotos(filter).then((p) => { if (!ignore) setPhotos(p) })
    return () => { ignore = true }
  }, [filter?.province, filter?.city, filter?.county])

  if (!filter || !filter.province) return null

  const place = [filter.province, filter.city, filter.county].filter(Boolean).join(' · ')

  if (collapsed) {
    // 竖排空间有限：只显示市+区县，且截断，避免过长换行
    const shortPlace = [filter.city && filter.city !== filter.province ? filter.city : filter.province, filter.county].filter(Boolean).join(' · ')
    const clipped = shortPlace.length > 9 ? shortPlace.slice(0, 9) + '…' : shortPlace
    return (
      <button className="photo-panel-tab" onClick={() => setCollapsed(false)} title={place}>
        <span className="photo-panel-tab-title">照片</span>
        <span className="photo-panel-tab-place">{clipped}</span>
        <span className="photo-panel-tab-arrow">◀</span>
      </button>
    )
  }

  return (
    <aside className="photo-panel">
      <div className="photo-panel-head">
        <div className="photo-panel-title">
          <span className="eyebrow">photos</span>
          <strong>{place}</strong>
        </div>
        <div className="panel-actions">
          <button className="panel-toggle" onClick={() => setCollapsed(true)} title="折叠">▶</button>
          <button className="panel-close" onClick={onClose} title="关闭">×</button>
        </div>
      </div>
      <div className="photo-panel-body">
        <p className="photo-panel-sub">{photos.length} 张照片</p>
        <PhotoGrid photos={photos} />
      </div>
    </aside>
  )
}
