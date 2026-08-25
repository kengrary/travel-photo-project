import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchPhotos, deletePhoto } from '../api.js'
import PhotoGrid from '../components/PhotoGrid.jsx'

function yearOf(t) { return t ? new Date(t).getFullYear() : null }
function monthOf(t) { return t ? new Date(t).getMonth() + 1 : null }

// 统计列表里的视频数量
const countVideos = (list) => list.reduce((n, p) => n + (p.media_type === 'video' ? 1 : 0), 0)

export default function TimelinePage() {
  const [photos, setPhotos] = useState([])
  // 展开的年份集合（多选）
  const [expandedYears, setExpandedYears] = useState(() => new Set())
  // 展开的省份集合（收起态内二级折叠，key = year|province）
  const [expandedProvs, setExpandedProvs] = useState(() => new Set())
  // 展开的具体地点（单开，key = year-month-place）
  const [expandedPlace, setExpandedPlace] = useState(null)
  const [searchText, setSearchText] = useState('')
  const [flashKey, setFlashKey] = useState(null)
  // 滚动时当前所在的年份（侧边索引高亮）
  const [activeYear, setActiveYear] = useState(null)
  const flashTimer = useRef(null)

  useEffect(() => {
    let ignore = false
    fetchPhotos().then((p) => { if (!ignore) setPhotos(p) })
    return () => { ignore = true }
  }, [])

  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current) }, [])

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
    return [...yearMap.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([year, months]) => {
        // 月倒序；月份内地点按该地最早拍摄时间正序（时间线直觉）
        const monthList = [...months.entries()]
          .sort((a, b) => b[0] - a[0])
          .map(([month, locs]) => ({
            month,
            places: [...locs.entries()]
              .map(([label, list]) => {
                const sorted = [...list].sort((a, b) => new Date(a.taken_at) - new Date(b.taken_at))
                return { label, province: sorted[0].province, photos: sorted, first: sorted[0].taken_at }
              })
              .sort((a, b) => new Date(a.first) - new Date(b.first)),
          }))
        // 全年地点聚合（收起态 chip）：跨月去重，按张数降序；再按省份分组
        const placeMap = new Map()
        let total = 0
        for (const { month, places } of monthList) {
          for (const p of places) {
            total += p.photos.length
            if (!placeMap.has(p.label)) {
              placeMap.set(p.label, { label: p.label, province: p.province || '未知', count: 0, month, year, key: `${year}-${month}-${p.label}` })
            }
            placeMap.get(p.label).count += p.photos.length
          }
        }
        const provMap = new Map()
        for (const pl of [...placeMap.values()].sort((a, b) => b.count - a.count)) {
          if (!provMap.has(pl.province)) provMap.set(pl.province, { name: pl.province, count: 0, places: [] })
          const prov = provMap.get(pl.province)
          prov.count += pl.count
          prov.places.push(pl)
        }
        // 省份按张数降序，未知位置垫底
        const provs = [...provMap.values()].sort((a, b) => {
          if (a.name === '未知') return 1
          if (b.name === '未知') return -1
          return b.count - a.count
        })
        return { year, months: monthList, provs, total }
      })
  }, [photos])

  // 地点搜索：跨年匹配 province·city·county 拼接串
  const q = searchText.trim().toLowerCase()
  const searchResults = useMemo(() => {
    if (!q) return []
    const out = []
    for (const { year, months } of years) {
      for (const { month, places } of months) {
        for (const p of places) {
          if (p.label.toLowerCase().includes(q)) {
            out.push({ year, month, province: p.province || '未知', label: p.label, count: p.photos.length, key: `${year}-${month}-${p.label}` })
          }
        }
      }
    }
    return out
  }, [years, q])

  // 侧边索引：滚动跟随高亮当前年份
  useEffect(() => {
    if (!years.length) return
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setActiveYear(Number(e.target.dataset.year))
        }
      },
      { rootMargin: '-40% 0px -55% 0px' }
    )
    const els = document.querySelectorAll('.tl-year[data-year]')
    els.forEach((el) => obs.observe(el))
    return () => obs.disconnect()
  }, [years])

  const toggleYear = (year) => {
    setExpandedYears((prev) => {
      const next = new Set(prev)
      if (next.has(year)) next.delete(year)
      else next.add(year)
      return next
    })
  }

  const allExpanded = years.length > 0 && expandedYears.size === years.length
  const toggleAll = () => {
    if (allExpanded) { setExpandedYears(new Set()); setExpandedProvs(new Set()) }
    else {
      setExpandedYears(new Set(years.map((y) => y.year)))
      setExpandedProvs(new Set(years.flatMap((y) => y.provs.map((pr) => `${y.year}|${pr.name}`))))
    }
  }

  const toggleProv = (provKey) => {
    setExpandedProvs((prev) => {
      const next = new Set(prev)
      if (next.has(provKey)) next.delete(provKey)
      else next.add(provKey)
      return next
    })
  }

  const jumpToYear = (year) => {
    setExpandedYears((prev) => new Set(prev).add(year))
    requestAnimationFrame(() => {
      document.getElementById(`tl-year-${year}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  // 定位地点：展开所属年份与省份 → 展开该地点 → 滚动并闪烁高亮
  const locatePlace = (year, month, province, key) => {
    setExpandedYears((prev) => new Set(prev).add(year))
    setExpandedProvs((prev) => new Set(prev).add(`${year}|${province}`))
    setExpandedPlace(key)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = document.getElementById(`tl-place-${key}`)
        if (!el) return
        el.scrollIntoView({ behavior: 'smooth', block: 'start' })
        setFlashKey(key)
        if (flashTimer.current) clearTimeout(flashTimer.current)
        flashTimer.current = setTimeout(() => setFlashKey(null), 1600)
      })
    })
  }

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
        <>
          <div className="tl-toolbar">
            <div className="tl-search">
              <input
                className="wall-filter-input"
                placeholder="搜索地点，如 大理、丽江、南海…"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
              />
              {q && (
                <div className="tl-search-results">
                  {searchResults.length === 0 && (
                    <div className="tl-search-empty">没有找到「{searchText.trim()}」相关地点</div>
                  )}
                  {searchResults.slice(0, 20).map((r) => (
                    <button
                      key={r.key}
                      className="tl-search-item"
                      onClick={() => { setSearchText(''); locatePlace(r.year, r.month, r.province, r.key) }}
                    >
                      <span className="tl-search-place">{r.label}</span>
                      <span className="tl-search-meta">{r.year}年{r.month}月 · {r.count} 张</span>
                    </button>
                  ))}
                  {searchResults.length > 20 && (
                    <div className="tl-search-more">…共 {searchResults.length} 处匹配，仅列前 20</div>
                  )}
                </div>
              )}
            </div>
            <span style={{ flex: 1 }} />
            <button className="btn btn-ghost" onClick={toggleAll}>
              {allExpanded ? '全部收起' : '全部展开'}
            </button>
          </div>

          <div className="tl-wrap">
            <aside className="tl-nav">
              <div className="tl-nav-title">年份索引</div>
              {years.map(({ year, total }) => (
                <button
                  key={year}
                  className={`tl-nav-item${activeYear === year ? ' active' : ''}`}
                  onClick={() => jumpToYear(year)}
                >
                  <span className="tl-nav-yr">{year}</span>
                  <span className="tl-nav-count">{total}</span>
                </button>
              ))}
            </aside>

            <div className="timeline">
              {years.map(({ year, months, provs, total }) => {
                const isOpen = expandedYears.has(year)
                return (
                  <div className="tl-year" id={`tl-year-${year}`} data-year={year} key={year}>
                    <div className="tl-year-label">{year}</div>
                    <button
                      className="tl-year-head"
                      aria-expanded={isOpen}
                      onClick={() => toggleYear(year)}
                    >
                      <span className="tl-year-chevron">{isOpen ? '▾' : '▸'}</span>
                      <span className="tl-year-title">{year} 年</span>
                      <span className="tl-year-count">{months.length} 个月 · {total} 张</span>
                    </button>

                    {!isOpen ? (
                      <div className="tl-year-provs">
                        {provs.map((prov) => {
                          const provKey = `${year}|${prov.name}`
                          const provOpen = expandedProvs.has(provKey)
                          return (
                            <div className="tl-prov" key={provKey}>
                              <button
                                className="tl-prov-head"
                                aria-expanded={provOpen}
                                onClick={() => toggleProv(provKey)}
                              >
                                <span className="tl-prov-chevron">{provOpen ? '▾' : '▸'}</span>
                                <span className="tl-prov-name">{prov.name}</span>
                                <span className="tl-prov-count">{prov.count} 张</span>
                              </button>
                              {provOpen && (
                                <div className="tl-year-chips">
                                  {prov.places.map((pl) => {
                                    const matched = q && pl.label.toLowerCase().includes(q)
                                    return (
                                      <button
                                        key={pl.key}
                                        className={`tl-chip${matched ? ' match' : ''}`}
                                        onClick={() => locatePlace(pl.year, pl.month, pl.province, pl.key)}
                                      >
                                        <span className="tl-chip-name">{pl.label}</span>
                                        <b className="tl-chip-count">{pl.count}</b>
                                      </button>
                                    )
                                  })}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    ) : (
                      <div className="tl-month-list">
                        {months.map(({ month, places: monthPlaces }) => (
                          <div className="tl-month" key={month}>
                            <div className="tl-month-label">{month}月</div>
                            <div className="tl-places">
                              {monthPlaces.map((place) => {
                                const expKey = `${year}-${month}-${place.label}`
                                const isOpenPlace = expandedPlace === expKey
                                return (
                                  <div
                                    className={`tl-place${flashKey === expKey ? ' flash' : ''}`}
                                    id={`tl-place-${expKey}`}
                                    key={expKey}
                                  >
                                    <button
                                      className="tl-place-btn"
                                      onClick={() => setExpandedPlace(isOpenPlace ? null : expKey)}
                                    >
                                      <span className="tl-place-name">{place.label}</span>
                                      <span className="tl-place-count">
                                        {place.photos.length} 张{countVideos(place.photos) > 0 ? ` · ${countVideos(place.photos)} 视频` : ''}
                                      </span>
                                      <span className="tl-place-arrow">{isOpenPlace ? '▾' : '▸'}</span>
                                    </button>
                                    {isOpenPlace && (
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
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
