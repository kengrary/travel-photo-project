import { useEffect, useRef, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { fetchPhotos } from '../api.js'

const CENTER = [104.2, 35.6]

// 高德中文栅格瓦片（自带全部中国省市县/街道中文地名与边界）
const GAODE_TILES = [
  'https://webrd01.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
  'https://webrd02.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
  'https://webrd03.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
  'https://webrd04.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
]
const GAODE_STYLE = {
  version: 8,
  sources: {
    gaode: {
      type: 'raster',
      tiles: GAODE_TILES,
      tileSize: 256,
      maxzoom: 18,
      attribution: '© 高德地图',
    },
  },
  layers: [
    { id: 'gaode-base', type: 'raster', source: 'gaode' },
  ],
}

// 跨页面导航保留相机位置（从照片墙返回不重置）
const mapState = {
  center: CENTER,
  zoom: 3.3,
}

export default function MapPage() {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const readyRef = useRef(false)
  const [photos, setPhotos] = useState([])
  const [hover, setHover] = useState(null)
  const navigate = useNavigate()

  const openWall = useCallback((province, city, county) => {
    const q = new URLSearchParams()
    if (province) q.set('province', province)
    if (city && city !== province) q.set('city', city)
    if (county) q.set('county', county)
    navigate(`/wall?${q.toString()}`)
  }, [navigate])

  // 加载照片并在图上打点（仅在 map ready 后调用）
  const loadPhotos = useCallback(async () => {
    const map = mapRef.current
    if (!map) return
    try {
      const phs = await fetchPhotos().catch(() => [])
      setPhotos(phs)

      const photoPoints = phs
        .filter((p) => p.lat != null && p.lng != null)
        .map((p) => ({
          type: 'Feature',
          properties: { id: p.id, province: p.province, city: p.city, county: p.county, name: p.original_name },
          geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
        }))

      if (map.getSource('photo-pins')) {
        map.getSource('photo-pins').setData({ type: 'FeatureCollection', features: photoPoints })
      } else if (photoPoints.length) {
        map.addSource('photo-pins', { type: 'geojson', data: { type: 'FeatureCollection', features: photoPoints } })
        map.addLayer({
          id: 'photo-pin-halo', type: 'circle', source: 'photo-pins',
          paint: {
            'circle-radius': 10, 'circle-color': 'rgba(200, 67, 47, 0.22)',
            'circle-stroke-color': '#c8432f', 'circle-stroke-width': 1.5,
          },
        })
        map.addLayer({
          id: 'photo-pin-dot', type: 'circle', source: 'photo-pins',
          paint: { 'circle-radius': 4, 'circle-color': '#c8432f' },
        })
      }

      if (!map._hasPinClick) {
        map._hasPinClick = true
        map.on('click', 'photo-pin-dot', (e) => {
          const f = e.features[0].properties
          openWall(f.province, f.city, f.county)
        })
        map.on('mouseenter', 'photo-pin-dot', () => {
          map.getCanvas().style.cursor = 'pointer'
          setHover('查看照片')
        })
        map.on('mouseleave', 'photo-pin-dot', () => {
          map.getCanvas().style.cursor = ''
          setHover(null)
        })
      }
    } catch (e) {
      console.error('loadPhotos failed', e)
    }
  }, [openWall])

  // 始终指向最新的 loadPhotos，供地图 load 回调调用
  const loadPhotosRef = useRef(loadPhotos)
  loadPhotosRef.current = loadPhotos

  // 初始地图：只创建一次，底图为高德中文瓦片
  useEffect(() => {
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: GAODE_STYLE,
      center: mapState.center,
      zoom: mapState.zoom,
      attributionControl: true,
    })
    mapRef.current = map
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')
    map.on('moveend', () => {
      const c = map.getCenter()
      mapState.center = [c.lng, c.lat]
      mapState.zoom = map.getZoom()
    })
    map.on('load', () => {
      readyRef.current = true
      loadPhotosRef.current()
    })
    return () => map.remove()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 保存当前相机位置到 mapState（挂载时恢复）
  useEffect(() => {
    return () => {
      if (mapRef.current) {
        const c = mapRef.current.getCenter()
        mapState.center = [c.lng, c.lat]
        mapState.zoom = mapRef.current.getZoom()
      }
    }
  }, [])

  const total = photos.filter((p) => p.lat != null).length
  const visited = new Set(photos.map((p) => p.province)).size

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
          已访 <b>{visited}</b> 省 · 照片 <b>{total}</b> 张
          {hover && <span style={{ marginLeft: 10 }}>↳ <b style={{ color: 'var(--vermillion)' }}>{hover}</b></span>}
        </div>
      </div>

      <div className="fab">
        <button className="btn btn-primary" onClick={() => navigate('/upload')}>＋ 上传照片</button>
      </div>
    </div>
  )
}
