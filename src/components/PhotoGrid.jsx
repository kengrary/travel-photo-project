import { useState } from 'react'
import Lightbox from './Lightbox.jsx'
import { rotatePhoto } from '../api.js'

export function fmtTime(t) {
  if (!t) return '未知时间'
  const d = new Date(t)
  if (isNaN(d)) return '未知时间'
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
}

export function fmtShortTime(t) {
  if (!t) return '未知时间'
  const d = new Date(t)
  if (isNaN(d)) return '未知时间'
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

export function fmtDuration(s) {
  if (!s) return ''
  const m = Math.floor(s / 60)
  const sec = Math.round(s % 60)
  return m > 0 ? `${m}:${String(sec).padStart(2, '0')}` : `0:${String(sec).padStart(2, '0')}`
}

export default function PhotoGrid({
  photos, onEmpty, onDelete, onDeleted, onPhotoDragStart,
  selectMode, selectedIds, onToggleSelect, onMove,
}) {
  const [lightboxIdx, setLightboxIdx] = useState(null)
  const [rotCount, setRotCount] = useState({})

  // 索引可能因列表变化越界，越界视为关闭
  const lbPhoto = lightboxIdx != null ? photos[lightboxIdx] : null

  const navLightbox = (delta) => setLightboxIdx((i) => {
    if (i == null || photos.length === 0) return null
    return (i + delta + photos.length) % photos.length
  })

  const handleDelete = async (photo) => {
    try {
      await onDelete(photo.id)
      setLightboxIdx(null)
      if (onDeleted) onDeleted(photo.id)
    } catch (e) {
      alert(`删除失败：${e.message}`)
    }
  }

  const handleDeleteClick = (e, photo) => {
    e.stopPropagation()
    if (!onDelete) return
    if (window.confirm(`确定删除这张照片「${photo.original_name}」吗？此操作不可恢复。`)) {
      handleDelete(photo)
    }
  }

  const handleRotate = async (e, photo) => {
    e.stopPropagation()
    try {
      await rotatePhoto(photo.id, 90)
      setRotCount((c) => ({ ...c, [photo.id]: (c[photo.id] || 0) + 1 }))
    } catch (err) {
      alert(`旋转失败：${err.message}`)
    }
  }

  return (
    <>
      {photos.length === 0 ? (
        onEmpty || (
          <div className="empty">
            <div className="empty-title">这里还没有照片</div>
            <p>上传几张带位置的旅行照片，它们就会出现在这里。</p>
          </div>
        )
      ) : (
        <div className="photogrid">
          {photos.map((p) => (
            <div
              key={p.id}
              className={[
                'photo-card',
                onPhotoDragStart && !selectMode ? ' draggable' : '',
                selectMode && selectedIds?.has(p.id) ? ' selected' : '',
                selectMode ? ' selectable' : '',
              ].join('')}
              onClick={() => {
                if (selectMode && onToggleSelect) onToggleSelect(p)
                else setLightboxIdx(photos.indexOf(p))
              }}
              draggable={!!onPhotoDragStart && !selectMode}
              onDragStart={onPhotoDragStart && !selectMode ? (e) => onPhotoDragStart(e, p) : undefined}
            >
              {selectMode && (
                <span className={`photo-check${selectedIds?.has(p.id) ? ' on' : ''}`}>{selectedIds?.has(p.id) ? '✓' : ''}</span>
              )}
              {p.media_type === 'video' ? (
                <video
                  src={`/uploads/${p.filename}`}
                  poster={`/uploads/${p.thumb_path}?t=${rotCount[p.id] || 0}`}
                  preload="metadata"
                  muted
                />
              ) : (
                <img src={`/uploads/${p.thumb_path}?t=${rotCount[p.id] || 0}`} alt={p.original_name} loading="lazy" />
              )}
              {p.media_type === 'video' && p.duration != null && (
                <span className="photo-duration">▶ {fmtDuration(p.duration)}</span>
              )}
              <div className="photo-cap">
                <div className="photo-cap-loc">
                  {[p.province, p.city, p.county].filter(Boolean).join(' ') || p.original_name}
                </div>
                <div className="photo-cap-time">{fmtShortTime(p.taken_at)}</div>
              </div>
              <div className="photo-actions">
                <button
                  className="photo-delete"
                  title="删除照片"
                  aria-label="删除照片"
                  onClick={(e) => handleDeleteClick(e, p)}
                >
                  🗑
                </button>
                {onMove && !selectMode && (
                  <button
                    className="photo-move"
                    title="移动到其他分组（补位置/补时间）"
                    aria-label="移动到其他分组"
                    onClick={(e) => { e.stopPropagation(); onMove(p) }}
                  >
                    ⇄
                  </button>
                )}
                {p.media_type !== 'video' && (
                  <button
                    className="photo-rotate"
                    title="旋转 90°"
                    aria-label="旋转 90°"
                    onClick={(e) => handleRotate(e, p)}
                  >
                    ↻
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      <Lightbox
        photo={lbPhoto}
        onClose={() => setLightboxIdx(null)}
        onDelete={onDelete ? handleDelete : null}
        onRotated={(id) => setRotCount((c) => ({ ...c, [id]: (c[id] || 0) + 1 }))}
        onPrev={photos.length > 1 ? () => navLightbox(-1) : null}
        onNext={photos.length > 1 ? () => navLightbox(1) : null}
      />
    </>
  )
}
