import { useEffect, useState } from 'react'
import { fmtTime } from './PhotoGrid.jsx'
import { rotatePhoto } from '../api.js'

export default function Lightbox({ photo, onClose, onDelete, onRotated, onPrev, onNext }) {
  const [bust, setBust] = useState(0)
  const [rotating, setRotating] = useState(false)

  useEffect(() => {
    if (!photo) return
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft' && onPrev) onPrev()
      if (e.key === 'ArrowRight' && onNext) onNext()
    }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  }, [photo, onClose, onPrev, onNext])

  // 切换照片时重置旋转刷新计数
  useEffect(() => {
    setBust(0)
    setRotating(false)
  }, [photo?.id])

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
      if (onRotated) onRotated(photo.id)
    } catch (e) {
      alert(`旋转失败：${e.message}`)
    } finally {
      setRotating(false)
    }
  }

  const fullSrc = `${photo.full_path ? `/uploads/${photo.full_path}` : `/uploads/${photo.filename}`}?t=${bust}`
  const isVideo = photo.media_type === 'video'
  const hasNav = Boolean(onPrev || onNext)

  return (
    <div className="lightbox" onClick={onClose}>
      {hasNav && onPrev && (
        <button className="lightbox-nav lightbox-nav-prev" aria-label="上一张" onClick={(e) => { e.stopPropagation(); onPrev() }}>‹</button>
      )}
      {hasNav && onNext && (
        <button className="lightbox-nav lightbox-nav-next" aria-label="下一张" onClick={(e) => { e.stopPropagation(); onNext() }}>›</button>
      )}
      <div className="lightbox-inner" onClick={(e) => e.stopPropagation()}>
        {isVideo ? (
          <video key={photo.id} src={`/uploads/${photo.filename}`} poster={fullSrc} controls autoPlay />
        ) : (
          <img key={photo.id} src={fullSrc} alt={photo.original_name} />
        )}
        <div className="lightbox-meta">
          <strong>{photo.original_name}</strong><br />
          {fmtTime(photo.taken_at)}
          {' · '}
          {[photo.province, photo.city, photo.county].filter(Boolean).join(' ') || '未知地点'}
          {photo.location_name ? ` · ${photo.location_name}` : ''}
        </div>
        <div className="lightbox-actions">
          {!isVideo && (
            <button className="btn btn-ghost" onClick={handleRotate} disabled={rotating}>
              {rotating ? '旋转中…' : '↻ 旋转 90°'}
            </button>
          )}
          {onDelete && (
            <button className="btn btn-delete" onClick={handleDelete}>删除照片</button>
          )}
        </div>
      </div>
    </div>
  )
}
