import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { fetchPhotos } from '../api.js'

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
    fetchPhotos(filter).then(setPhotos)
  }, [params.toString(), orderBy])

  const title = [filter.province, filter.city, filter.county].filter(Boolean).join(' · ') || '全部照片'

  return (
    <div style={{ paddingTop: 48, paddingBottom: 24 }}>
      <h2 style={{ padding: '0 16px' }}>{title}</h2>
      <div style={{ padding: '0 16px', display: 'flex', gap: 8, margin: '12px 0' }}>
        <button onClick={() => setOrderBy('time')} style={orderBy === 'time' ? active : {}}>按时间</button>
        <button onClick={() => setOrderBy('location')} style={orderBy === 'location' ? active : {}}>按地点</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8, padding: 16 }}>
        {photos.map((p) => (
          <img
            key={p.id}
            src={`/uploads/${p.thumb_path}`}
            alt={p.original_name}
            onClick={() => setLightbox(p)}
            style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', cursor: 'pointer', borderRadius: 6 }}
          />
        ))}
      </div>
      {photos.length === 0 && <p style={{ padding: '0 16px', color: '#888' }}>暂无照片</p>}
      {lightbox && (
        <div onClick={() => setLightbox(null)} style={overlay}>
          <div onClick={(e) => e.stopPropagation()}>
            <img src={`/uploads/${lightbox.filename}`} style={{ maxWidth: '90vw', maxHeight: '80vh' }} />
            <p style={{ color: '#fff', marginTop: 8 }}>
              {lightbox.original_name} · {lightbox.taken_at || '未知时间'} ·{' '}
              {[lightbox.province, lightbox.city, lightbox.county].filter(Boolean).join(' ') || '未知地点'}
              {lightbox.location_name ? ` · ${lightbox.location_name}` : ''}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

const active = { fontWeight: 'bold', borderBottom: '2px solid #333' }
const overlay = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'zoom-out', zIndex: 100,
}
