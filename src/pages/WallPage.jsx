import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { fetchPhotos, deletePhoto } from '../api.js'
import PhotoGrid from '../components/PhotoGrid.jsx'

function monthKey(t) {
  if (!t) return null
  const d = new Date(t)
  if (isNaN(d)) return null
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function monthLabel(t) {
  const d = new Date(t)
  return `${d.getFullYear()}年${d.getMonth() + 1}月`
}

export default function WallPage() {
  const [params] = useSearchParams()
  const [photos, setPhotos] = useState([])
  const [orderBy, setOrderBy] = useState('time')

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

  // 按时间或地点分组
  const groups = useMemo(() => {
    const result = []
    if (orderBy === 'location') {
      const map = new Map()
      for (const p of photos) {
        const key = [p.province, p.city, p.county].filter(Boolean).join(' · ') || '未知地点'
        if (!map.has(key)) map.set(key, [])
        map.get(key).push(p)
      }
      for (const [label, list] of map) result.push({ label, sub: `${list.length} 张照片`, photos: list })
    } else {
      const map = new Map()
      const unknown = []
      for (const p of photos) {
        const key = monthKey(p.taken_at)
        if (!key) { unknown.push(p); continue }
        if (!map.has(key)) map.set(key, [])
        map.get(key).push(p)
      }
      // 月份从新到旧
      const keys = [...map.keys()].sort().reverse()
      for (const key of keys) {
        const list = map.get(key)
        const sample = list[0]
        result.push({ label: monthLabel(sample.taken_at), sub: `${list.length} 张照片`, photos: list })
      }
      if (unknown.length) result.push({ label: '未知时间', sub: `${unknown.length} 张照片`, photos: unknown })
    }
    return result
  }, [photos, orderBy])

  const place = [filter.province, filter.city, filter.county].filter(Boolean).join(' · ')
  const title = place || '全部照片'

  const handleDeleted = (id) => setPhotos((list) => list.filter((p) => p.id !== id))

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
          <p>上传几张带位置的旅行照片，它们就会出现在这里。</p>
        </div>
      ) : (
        <div className="wall-groups">
          {groups.map((g) => (
            <section key={g.label} className="wall-group">
              <header className="wall-group-head">
                <h2 className="wall-group-title">{g.label}</h2>
                <span className="wall-group-sub">{g.sub}</span>
              </header>
              <PhotoGrid photos={g.photos} onDelete={deletePhoto} onDeleted={handleDeleted} />
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
