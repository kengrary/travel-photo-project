import { useState } from 'react'
import Lightbox from './Lightbox.jsx'

export function fmtTime(t) {
  if (!t) return '未知时间'
  const d = new Date(t)
  if (isNaN(d)) return '未知时间'
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
}

export default function PhotoGrid({ photos, onEmpty, onDelete, onDeleted }) {
  const [lightbox, setLightbox] = useState(null)

  const handleDelete = async (photo) => {
    try {
      await onDelete(photo.id)
      setLightbox(null)
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
            <div key={p.id} className="photo-card" onClick={() => setLightbox(p)}>
              <img src={`/uploads/${p.thumb_path}`} alt={p.original_name} loading="lazy" />
              <div className="photo-cap">
                {[p.province, p.city, p.county].filter(Boolean).join(' ') || p.original_name}
              </div>
              {onDelete && (
                <button
                  className="photo-delete"
                  title="删除照片"
                  aria-label="删除照片"
                  onClick={(e) => handleDeleteClick(e, p)}
                >
                  🗑
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <Lightbox photo={lightbox} onClose={() => setLightbox(null)} onDelete={onDelete ? handleDelete : null} />
    </>
  )
}
