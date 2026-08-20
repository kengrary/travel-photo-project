import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { fetchPhotos } from '../api.js'
import PhotoGrid from '../components/PhotoGrid.jsx'

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

      <PhotoGrid photos={photos} />
    </div>
  )
}
