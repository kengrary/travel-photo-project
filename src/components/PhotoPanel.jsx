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

  return (
    <aside className={`photo-panel${collapsed ? ' collapsed' : ''}`}>
      <div className="photo-panel-head">
        {collapsed ? (
          <button className="panel-toggle" onClick={() => setCollapsed(false)} title="展开">◀</button>
        ) : (
          <>
            <div className="photo-panel-title">
              <span className="eyebrow">photos</span>
              <strong>{place}</strong>
            </div>
            <div className="panel-actions">
              <button className="panel-toggle" onClick={() => setCollapsed(true)} title="折叠">▶</button>
              <button className="panel-close" onClick={onClose} title="关闭">×</button>
            </div>
          </>
        )}
      </div>
      {!collapsed && (
        <div className="photo-panel-body">
          <p className="photo-panel-sub">{photos.length} 张照片</p>
          <PhotoGrid photos={photos} />
        </div>
      )}
    </aside>
  )
}
