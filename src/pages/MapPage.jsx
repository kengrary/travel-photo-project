import { useEffect, useRef, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { fetchLocations, fetchPhotos } from '../api.js'

const CENTER = [104.2, 35.6]
const BASE_STYLE = 'https://demotiles.maplibre.org/style.json'
const PROVINCE_ADCODE = '100000'

function regionFile(adcode) {
  return `/data/${adcode}_full.json`
}

// 跨页面导航保留地图状态（view 层级 + 相机位置），避免从照片墙返回时重置
const mapState = {
  view: { level: 'province', adcode: PROVINCE_ADCODE, name: '全国', province: null, city: null, parent: null },
  center: CENTER,
  zoom: 3.3,
}

export default function MapPage() {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const [locations, setLocations] = useState([])
  const [photos, setPhotos] = useState([])
  const [hover, setHover] = useState(null)
  // view: { level, adcode, name, province, city, parent }
  // level: province | city | county ; parent = 上级 view（用于返回）
  const [view, setView] = useState(mapState.view)
  const navigate = useNavigate()

  const openWall = useCallback((province, city, county) => {
    const q = new URLSearchParams()
    if (province) q.set('province', province)
    if (city && city !== province) q.set('city', city)
    if (county) q.set('county', county)
    navigate(`/wall?${q.toString()}`)
  }, [navigate])

  // 初始地图（恢复上次的相机位置）
  useEffect(() => {
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASE_STYLE,
      center: mapState.center,
      zoom: mapState.zoom,
      attributionControl: false,
    })
    mapRef.current = map
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')
    map.on('moveend', () => {
      const c = map.getCenter()
      mapState.center = [c.lng, c.lat]
      mapState.zoom = map.getZoom()
    })
    return () => map.remove()
  }, [])

  // 持久化当前 view，跨导航保留下钻层级
  useEffect(() => {
    mapState.view = view
  }, [view])

  // 加载当前层级边界 + 照片点
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    let cancelled = false

    async function load() {
      if (cancelled) return
      let locs = []
      let phs = []
      try { locs = await fetchLocations() } catch {}
      try { phs = await fetchPhotos() } catch {}
      if (cancelled) return
      setLocations(locs)
      setPhotos(phs)

      const res = await fetch(regionFile(view.adcode))
      const geojson = await res.json()
      if (cancelled) return

      const photoPoints = phs
        .filter((p) => p.lat != null && p.lng != null)
        .map((p) => ({
          type: 'Feature',
          properties: { id: p.id, province: p.province, city: p.city, county: p.county, name: p.original_name },
          geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
        }))

      if (map.getSource('regions')) {
        map.getSource('regions').setData(geojson)
      } else {
        map.addSource('regions', { type: 'geojson', data: geojson })
        map.addLayer({
          id: 'region-fill', type: 'fill', source: 'regions',
          paint: { 'fill-color': '#efe6d2', 'fill-opacity': 0.75, 'fill-outline-color': '#d8c9ac' },
        })
        map.addLayer({
          id: 'region-line', type: 'line', source: 'regions',
          paint: { 'line-color': '#b7a57f', 'line-width': 1 },
        })
      }

      const labelPoints = geojson.features
        .filter((f) => f.properties.name && Array.isArray(f.properties.center))
        .map((f) => ({
          type: 'Feature',
          properties: { name: f.properties.name },
          geometry: { type: 'Point', coordinates: f.properties.center },
        }))
      if (map.getSource('region-labels')) {
        map.getSource('region-labels').setData({ type: 'FeatureCollection', features: labelPoints })
      } else {
        map.addSource('region-labels', { type: 'geojson', data: { type: 'FeatureCollection', features: labelPoints } })
        map.addLayer({
          id: 'region-label', type: 'symbol', source: 'region-labels',
          layout: {
            'text-field': ['get', 'name'],
            'text-size': view.level === 'province' ? 12 : 10.5,
            'text-letter-spacing': 0.05,
            'text-allow-overlap': false,
            'text-ignore-placement': false,
          },
          paint: {
            'text-color': '#5c4a32',
            'text-halo-color': '#f7efdd', 'text-halo-width': 1.6,
          },
        })
      }

      if (map.getSource('photo-pins')) {
        map.getSource('photo-pins').setData({ type: 'FeatureCollection', features: photoPoints })
      } else if (photoPoints.length) {
        map.addSource('photo-pins', { type: 'geojson', data: { type: 'FeatureCollection', features: photoPoints } })
        map.addLayer({
          id: 'photo-pin-halo', type: 'circle', source: 'photo-pins',
          paint: {
            'circle-radius': 10, 'circle-color': 'rgba(200, 67, 47, 0.18)',
            'circle-stroke-color': '#c8432f', 'circle-stroke-width': 1.5,
          },
        })
        map.addLayer({
          id: 'photo-pin-dot', type: 'circle', source: 'photo-pins',
          paint: { 'circle-radius': 4, 'circle-color': '#c8432f' },
        })
      }

      if (!map._hasRegionClick) {
        map._hasRegionClick = true
        map.on('click', 'region-fill', (e) => drill(e.features[0].properties))
        map.on('mouseenter', 'region-fill', (e) => {
          map.getCanvas().style.cursor = 'pointer'
          setHover(e.features[0].properties.name)
        })
        map.on('mouseleave', 'region-fill', () => {
          map.getCanvas().style.cursor = ''
          setHover(null)
        })
        map.on('click', 'photo-pin-dot', (e) => {
          const f = e.features[0].properties
          openWall(f.province, f.city, f.county)
        })
        map.on('mouseenter', 'photo-pin-dot', () => (map.getCanvas().style.cursor = 'pointer'))
        map.on('mouseleave', 'photo-pin-dot', () => (map.getCanvas().style.cursor = ''))
      }
    }

    // 下钻：进入某区域下一级，或进照片墙
    function drill(props) {
      const level = props.level // province / city / district
      const name = props.name
      const adcode = String(props.adcode)
      const childrenNum = props.childrenNum || 0

      if (level === 'province' && childrenNum > 0) {
        setView({ level: 'city', adcode, name, province: name, city: null, parent: view })
      } else if (level === 'city' && childrenNum > 0) {
        setView({ level: 'county', adcode, name, province: view.province, city: name, parent: view })
      } else {
        // district：进照片墙（直辖市下也是 district，city 为空时仅按省+区县过滤）
        openWall(view.province, view.city, name)
      }
      zoomTo(adcode)
    }

    function zoomTo(adcode) {
      fetch(regionFile(adcode)).then((r) => r.json()).then((fc) => {
        const bounds = new maplibregl.LngLatBounds()
        const walk = (coords) => {
          if (typeof coords[0] === 'number') bounds.extend([coords[0], coords[1]])
          else coords.forEach(walk)
        }
        fc.features.forEach((f) => walk(f.geometry.coordinates))
        if (!bounds.isEmpty() && mapRef.current) {
          mapRef.current.fitBounds(bounds, { padding: 60, maxZoom: 10, duration: 600 })
        }
      }).catch(() => {})
    }

    load()
    return () => { cancelled = true }
  }, [view, navigate, openWall])

  const total = photos.filter((p) => p.lat != null).length
  const visited = new Set(photos.map((p) => p.province)).size

  const back = () => {
    if (view.parent) setView(view.parent)
  }

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
      <div style={{ position: 'absolute', inset: 8, border: '1px solid var(--line-strong)', pointerEvents: 'none', zIndex: 5, borderRadius: 'var(--radius)' }} />

      <svg className="graticule" style={{ position: 'absolute', inset: 8, zIndex: 5, pointerEvents: 'none' }} preserveAspectRatio="none" viewBox="0 0 100 100">
        <g stroke="rgba(183,165,127,0.30)" strokeWidth="0.15" fill="none">
          {[10, 20, 30, 40, 50, 60, 70, 80, 90].map((x) => <line key={`v${x}`} x1={x} y1="0" x2={x} y2="100" />)}
          {[10, 20, 30, 40, 50, 60, 70, 80, 90].map((y) => <line key={`h${y}`} x1="0" y1={y} x2="100" y2={y} />)}
        </g>
      </svg>

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
          <b>{view.name}</b> · 已访 <b>{visited}</b> 省 · 照片 <b>{total}</b> 张
          {view.level !== 'province' && (
            <button onClick={back} style={{ marginLeft: 10, border: '1px solid var(--line-strong)', background: 'transparent', borderRadius: 4, padding: '2px 8px', fontSize: 12, cursor: 'pointer' }}>← 返回</button>
          )}
        </div>
        {hover && <div className="chip">↳ {hover}（点击进入下一级）</div>}
      </div>

      <div className="fab">
        <button className="btn btn-primary" onClick={() => navigate('/upload')}>＋ 上传照片</button>
      </div>
    </div>
  )
}
