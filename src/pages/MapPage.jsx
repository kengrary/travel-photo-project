import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { fetchLocations } from '../api.js'

const CENTER = [104.2, 35.6]
// 免费无 key 底图（英文地形/国界），中文省份名由下面叠加的 GeoJSON 标签图层提供
const BASE_STYLE = 'https://demotiles.maplibre.org/style.json'

export default function MapPage() {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const [locations, setLocations] = useState([])
  const [hover, setHover] = useState(null)
  const navigate = useNavigate()

  useEffect(() => {
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASE_STYLE,
      center: CENTER,
      zoom: 3.3,
      attributionControl: false,
    })
    mapRef.current = map
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')

    map.on('load', async () => {
      // 各市县照片数量，用于着色 + 顶部统计
      let locs = []
      try { locs = await fetchLocations() } catch {}
      setLocations(locs)

      const res = await fetch('/data/100000_full.json')
      const geojson = await res.json()

      map.addSource('provinces', { type: 'geojson', data: geojson })
      map.addLayer({
        id: 'province-fill',
        type: 'fill',
        source: 'provinces',
        paint: {
          'fill-color': '#f2e9e0',
          'fill-opacity': 0.85,
          'fill-outline-color': '#d8cab8',
        },
      })
      map.addLayer({
        id: 'province-line',
        type: 'line',
        source: 'provinces',
        paint: { 'line-color': '#c9b9a3', 'line-width': 1 },
      })

      // 中文省份名标签（从 GeoJSON 的 name/center 叠加，解决底图英文问题）
      map.addLayer({
        id: 'province-label',
        type: 'symbol',
        source: 'provinces',
        layout: {
          'text-field': ['get', 'name'],
          'text-size': 12,
          'text-letter-spacing': 0.08,
        },
        paint: {
          'text-color': '#5c4630',
          'text-halo-color': '#fff7ec',
          'text-halo-width': 1.6,
        },
      })

      map.on('click', 'province-fill', (e) => {
        const name = e.features[0].properties.name
        navigate(`/wall?province=${encodeURIComponent(name)}`)
      })
      map.on('mouseenter', 'province-fill', (e) => {
        map.getCanvas().style.cursor = 'pointer'
        setHover(e.features[0].properties.name)
      })
      map.on('mouseleave', 'province-fill', () => {
        map.getCanvas().style.cursor = ''
        setHover(null)
      })
    })

    return () => map.remove()
  }, [navigate])

  // 按省汇总照片数（省名 -> 总数），用于顶部信息
  const byProvince = {}
  for (const l of locations) {
    const key = l.province || '未定位'
    byProvince[key] = (byProvince[key] || 0) + l.count
  }
  const total = locations.reduce((s, l) => s + l.count, 0)
  const visited = Object.keys(byProvince).length

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      <div className="map-chips">
        <div className="chip">
          已去 <b>{visited}</b> 个省级行政区 · 共 <b>{total}</b> 张照片
        </div>
        {hover && <div className="chip">当前：<b>{hover}</b>（点击查看照片）</div>}
      </div>

      <div className="fab">
        <button className="btn btn-primary" onClick={() => navigate('/upload')}>＋ 上传照片</button>
      </div>
    </div>
  )
}
