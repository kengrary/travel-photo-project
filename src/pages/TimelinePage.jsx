import { useEffect, useMemo, useState } from 'react'
import { fetchPhotos, deletePhoto } from '../api.js'
import PhotoGrid from '../components/PhotoGrid.jsx'

function yearOf(t) { return t ? new Date(t).getFullYear() : null }
function monthOf(t) { return t ? new Date(t).getMonth() + 1 : null }

// 统计列表里的视频数量
const countVideos = (list) => list.reduce((n, p) => n + (p.media_type === 'video' ? 1 : 0), 0)

export default function TimelinePage() {
  const [photos, setPhotos] = useState([])
  const [expanded, setExpanded] = useState(null) // { year, month, key }

  useEffect(() => {
    let ignore = false
    fetchPhotos().then((p) => { if (!ignore) setPhotos(p) })
    return () => { ignore = true }
  }, [])

  // 按 年 → 月 → 地点 聚合（仅取有拍摄时间的照片）
  const years = useMemo(() => {
    const yearMap = new Map()
    for (const p of photos) {
      const y = yearOf(p.taken_at)
      const m = monthOf(p.taken_at)
      if (!y || !m) continue
      if (!yearMap.has(y)) yearMap.set(y, new Map())
      const monthMap = yearMap.get(y)
      if (!monthMap.has(m)) monthMap.set(m, new Map())
      const locKey = [p.province, p.city, p.county].filter(Boolean).join(' · ') || '未知地点'
      if (!monthMap.get(m).has(locKey)) monthMap.get(m).set(locKey, [])
      monthMap.get(m).get(locKey).push(p)
    }
    // 组装为数组：年倒序、月倒序；月份内地点按该地最早拍摄时间正序（时间线直觉）
    return [...yearMap.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([year, months]) => ({
        year,
        months: [...months.entries()]
          .sort((a, b) => b[0] - a[0])
          .map(([month, locs]) => ({
            month,
            places: [...locs.entries()]
              .map(([label, list]) => {
                const sorted = [...list].sort((a, b) => new Date(a.taken_at) - new Date(b.taken_at))
                return { label, photos: sorted, first: sorted[0].taken_at }
              })
              .sort((a, b) => new Date(a.first) - new Date(b.first)),
          })),
      }))
  }, [photos])

  const withTime = photos.filter((p) => p.taken_at).length
  const handleDeleted = (id) => setPhotos((list) => list.filter((p) => p.id !== id))

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">journey · timeline</div>
          <h1 className="page-title">旅行时间轴</h1>
          <p className="page-sub">按年月回顾你去过的地方 · {withTime} 张有拍摄时间的照片</p>
        </div>
      </div>

      {years.length === 0 ? (
        <div className="empty">
          <div className="empty-title">暂无时间轴数据</div>
          <p>照片需要有拍摄时间才会出现在这里。没有时间的照片可在「照片墙」中拖拽到对应月份补充。</p>
        </div>
      ) : (
        <div className="timeline">
          {years.map(({ year, months }) => (
            <div className="tl-year" key={year}>
              <div className="tl-year-label">{year}</div>
              <div className="tl-month-list">
                {months.map(({ month, places }) => (
                  <div className="tl-month" key={month}>
                    <div className="tl-month-label">{month}月</div>
                    <div className="tl-places">
                      {places.map((place) => {
                        const expKey = `${year}-${month}-${place.label}`
                        const isOpen = expanded && expanded.key === expKey
                        return (
                          <div className="tl-place" key={place.label}>
                            <button
                              className="tl-place-btn"
                              onClick={() => setExpanded(isOpen ? null : { key: expKey })}
                            >
                              <span className="tl-place-name">{place.label}</span>
                              <span className="tl-place-count">
                                {place.photos.length} 张{countVideos(place.photos) > 0 ? ` · ${countVideos(place.photos)} 视频` : ''}
                              </span>
                              <span className="tl-place-arrow">{isOpen ? '▾' : '▸'}</span>
                            </button>
                            {isOpen && (
                              <div className="tl-place-expand">
                                <PhotoGrid photos={place.photos} onDelete={deletePhoto} onDeleted={handleDeleted} />
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
