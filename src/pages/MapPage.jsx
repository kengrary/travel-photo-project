import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { fetchLocations } from '../api.js'

const CENTER = [104.2, 35.6]
// 免费无 key 底图（英文国界/地形）；中文省份名与图钉由下面叠加的图层提供
const BASE_STYLE = 'https://demotiles.maplibre.org/style.json'

export default function MapPage() {
  const containerRef = useRef(null)
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
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')

    map.on('load', async () => {
      let locs = []
      try { locs = await fetchLocations() } catch {}
      setLocations(locs)

      const res = await fetch('/data/100000_full.json')
      const geojson = await res.json()

      // 各省照片数：为图钉图层准备
      const countByProv = {}
      for (const l of locs) countByProv[l.province] = (countByProv[l.province] || 0) + l.count

      map.addSource('provinces', { type: 'geojson', data: geojson })
      map.addLayer({
        id: 'province-fill', type: 'fill', source: 'provinces',
        paint: { 'fill-color': '#efe6d2', 'fill-opacity': 0.75, 'fill-outline-color': '#d8c9ac' },
      })
      map.addLayer({
        id: 'province-line', type: 'line', source: 'provinces',
        paint: { 'line-color': '#b7a57f', 'line-width': 1 },
      })
      // 中文省份名（从 GeoJSON 叠加，解决底图英文）
      map.addLayer({
        id: 'province-label', type: 'symbol', source: 'provinces',
        layout: {
          'text-field': ['get', 'name'],
          'text-size': 12, 'text-letter-spacing': 0.1,
        },
        paint: {
          'text-color': '#5c4a32',
          'text-halo-color': '#f7efdd', 'text-halo-width': 1.8,
        },
      })

      // 图钉：有照片的省份用 vermilion 圆点标出，数量越多越大
      const pins = geojson.features
        .map((f) => ({ ...f, properties: { ...f.properties, count: countByProv[f.properties.name] || 0 } }))
        .filter((f) => f.properties.count > 0)
      if (pins.length) {
        map.addSource('pins', { type: 'geojson', data: { type: 'FeatureCollection', features: pins } })
        map.addLayer({
          id: 'pin-halo', type: 'circle', source: 'pins',
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['get', 'count'], 0, 10, 50, 16],
            'circle-color': 'rgba(200, 67, 47, 0.18)', 'circle-stroke-color': '#c8432f', 'circle-stroke-width': 1.5,
          },
        })
        map.addLayer({
          id: 'pin-dot', type: 'circle', source: 'pins',
          paint: { 'circle-radius': 3, 'circle-color': '#c8432f' },
        })
      }

      map.on('click', 'province-fill', (e) => {
        navigate(`/wall?province=${encodeURIComponent(e.features[0].properties.name)}`)
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

  const total = locations.reduce((s, l) => s + l.count, 0)
  const visited = new Set(locations.map((l) => l.province)).size

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      {/* 地图作为图版，四周用发丝线框 */}
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
      <div style={{ position: 'absolute', inset: 8, border: '1px solid var(--line-strong)', pointerEvents: 'none', zIndex: 5, borderRadius: 'var(--radius)' }} />

      {/* 经纬网（graticule）：低透明度发丝网格 */}
      <svg className="graticule" style={{ position: 'absolute', inset: 8, zIndex: 5, pointerEvents: 'none' }} preserveAspectRatio="none" viewBox="0 0 100 100">
        <g stroke="rgba(183,165,127,0.30)" strokeWidth="0.15" fill="none">
          {[10, 20, 30, 40, 50, 60, 70, 80, 90].map((x) => (
            <line key={`v${x}`} x1={x} y1="0" x2={x} y2="100" />
          ))}
          {[10, 20, 30, 40, 50, 60, 70, 80, 90].map((y) => (
            <line key={`h${y}`} x1="0" y1={y} x2="100" y2={y} />
          ))}
        </g>
      </svg>

      {/* 罗盘 */}
      <div className="compass">
        <svg viewBox="0 0 64 64">
          <g fill="none" stroke="#35322c" strokeWidth="1.5">
            <circle cx="32" cy="32" r="30" />
            <circle cx="32" cy="32" r="26" strokeDasharray="2 3" />
            <path d="M32 8 L36 32 L32 56 L28 32 Z" fill="#c8432f" stroke="#c8432f" />
            <path d="M32 8 L32 56 M32 8 L36 32 L28 32 Z" stroke="#35322c" strokeWidth="0.6" />
          </g>
          <text x="32" y="20" textAnchor="middle" fontSize="6" fill="#35322c" fontFamily="var(--mono)">N</text>
        </svg>
      </div>

      <div className="map-chips">
        <div className="chip">
          已访 <b>{visited}</b> 省 · 照片 <b>{total}</b> 张
        </div>
        {hover && <div className="chip">↳ {hover}（点击查看）</div>}
      </div>

      <div className="fab">
        <button className="btn btn-primary" onClick={() => navigate('/upload')}>＋ 上传照片</button>
      </div>
    </div>
  )
}
