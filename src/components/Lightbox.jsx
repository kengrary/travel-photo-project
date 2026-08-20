import { useEffect } from 'react'
import { fmtTime } from './PhotoGrid.jsx'

export default function Lightbox({ photo, onClose }) {
  useEffect(() => {
    if (!photo) return
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  }, [photo, onClose])

  if (!photo) return null

  return (
    <div className="lightbox" onClick={onClose}>
      <div className="lightbox-inner" onClick={(e) => e.stopPropagation()}>
        <img src={`/uploads/${photo.filename}`} alt={photo.original_name} />
        <div className="lightbox-meta">
          <strong>{photo.original_name}</strong><br />
          {fmtTime(photo.taken_at)}
          {' · '}
          {[photo.province, photo.city, photo.county].filter(Boolean).join(' ') || '未知地点'}
          {photo.location_name ? ` · ${photo.location_name}` : ''}
        </div>
      </div>
    </div>
  )
}
