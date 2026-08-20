import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { fetchPhotos } from '../api.js'

function fmtTime(t) {
  if (!t) return '未知时间'
  const d = new Date(t)
  if (isNaN(d)) return '未知时间'
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
}

export default function WallPage() {
  const [params] = useSearchParams()
  const [photos, setPhotos] = useState([])
  const [orderBy, setOrderBy] = useState('time')
  const [lightbox, setLightbox] = useState(null)

  const filter = {
    province: params.get('province') || undefined,
    city: params.get('city') || undefined,
    county: params.get('county') || undefined,
    orderBy,
  }

  useEffect(() => {
    let ignore = false
    fetchPhotos(filter).then((p) => { if (!ignore) setPhotos(p) })
    return () => { ignore = true }
  }, [params.toString(), orderBy])

  useEffect(() => {
    if (!lightbox) return
    const onKey = (e) => { if (e.key === 'Escape') setLightbox(null) }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  }, [lightbox])

  const place = [filter.province, filter.city, filter.county].filter(Boolean).join(' · ')
  const title = place || '全部照片'

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">photo log · {place || '全部'}</div>
          <h1 className="page-title">{title}</h1>
          <p className="page-sub">{photos.length} 张照片{place ? ` · 拍摄于 ${place}` : ''}</p>
        </div>
        <div className="seg">
          <button className={orderBy === 'time' ? 'on' : ''} onClick={() => setOrderBy('time')}>按时间</button>
          <button className={orderBy === 'location' ? 'on' : ''} onClick={() => setOrderBy('location')}>按地点</button>
        </div>
      </div>

      {photos.length === 0 ? (
        <div className="empty">
          <div className="empty-title">这里还没有照片</div>
          <p>上传几张带位置的旅行照片，它们就会出现在这里。<br />到「上传」页选择照片，自动定位到拍摄的省市县。</p>
        </div>
      ) : (
        <div className="photogrid">
          {photos.map((p) => (
            <div key={p.id} className="photo-card" onClick={() => setLightbox(p)}>
              <img src={`/uploads/${p.thumb_path}`} alt={p.original_name} loading="lazy" />
              <div className="photo-cap">
                {[p.province, p.city, p.county].filter(Boolean).join(' ') || p.original_name}
              </div>
            </div>
          ))}
        </div>
      )}

      {lightbox && (
        <div className="lightbox" onClick={() => setLightbox(null)}>
          <div className="lightbox-inner" onClick={(e) => e.stopPropagation()}>
            <img src={`/uploads/${lightbox.filename}`} alt={lightbox.original_name} />
            <div className="lightbox-meta">
              <strong>{lightbox.original_name}</strong><br />
              {fmtTime(lightbox.taken_at)}
              {' · '}
              {[lightbox.province, lightbox.city, lightbox.county].filter(Boolean).join(' ') || '未知地点'}
              {lightbox.location_name ? ` · ${lightbox.location_name}` : ''}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
