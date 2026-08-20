import { useEffect } from 'react'
import { fmtTime } from './PhotoGrid.jsx'

export default function Lightbox({ photo, onClose, onDelete }) {
  useEffect(() => {
    if (!photo) return
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  }, [photo, onClose])

  if (!photo) return null

  const handleDelete = () => {
    if (!onDelete) return
    if (window.confirm(`确定删除这张照片「${photo.original_name}」吗？此操作不可恢复。`)) {
      onDelete(photo)
    }
  }

  const fullSrc = photo.full_path ? `/uploads/${photo.full_path}` : `/uploads/${photo.filename}`

  return (
    <div className="lightbox" onClick={onClose}>
      <div className="lightbox-inner" onClick={(e) => e.stopPropagation()}>
        <img src={fullSrc} alt={photo.original_name} />
        <div className="lightbox-meta">
          <strong>{photo.original_name}</strong><br />
          {fmtTime(photo.taken_at)}
          {' · '}
          {[photo.province, photo.city, photo.county].filter(Boolean).join(' ') || '未知地点'}
          {photo.location_name ? ` · ${photo.location_name}` : ''}
        </div>
        {onDelete && (
          <button className="btn btn-delete" onClick={handleDelete}>删除照片</button>
        )}
      </div>
    </div>
  )
}
