import { useEffect, useState } from 'react'
import { fmtTime } from './PhotoGrid.jsx'
import { rotatePhoto } from '../api.js'

export default function Lightbox({ photo, onClose, onDelete }) {
  const [bust, setBust] = useState(0)
  const [rotating, setRotating] = useState(false)

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

  const handleRotate = async () => {
    if (rotating) return
    setRotating(true)
    try {
      await rotatePhoto(photo.id, 90)
      setBust((n) => n + 1) // 刷新图片缓存
    } catch (e) {
      alert(`旋转失败：${e.message}`)
    } finally {
      setRotating(false)
    }
  }

  const fullSrc = `${photo.full_path ? `/uploads/${photo.full_path}` : `/uploads/${photo.filename}`}?t=${bust}`

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
        <div className="lightbox-actions">
          <button className="btn btn-ghost" onClick={handleRotate} disabled={rotating}>
            {rotating ? '旋转中…' : '↻ 旋转 90°'}
          </button>
          {onDelete && (
            <button className="btn btn-delete" onClick={handleDelete}>删除照片</button>
          )}
        </div>
      </div>
    </div>
  )
}
