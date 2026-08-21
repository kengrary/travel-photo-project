import { useEffect, useRef, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import maplibregl from 'maplibre-gl'
import Supercluster from 'supercluster'
import 'maplibre-gl/dist/maplibre-gl.css'
import { fetchPhotos } from '../api.js'
import PhotoPanel from '../components/PhotoPanel.jsx'

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
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
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

// 用 canvas 生成图钉(teardrop)图片：上部半圆帽 + 底部尖端 + 钉帽中空圆环
// 颜色随数量档变化（低=浅青、中=图册蓝、高=深靛蓝），钉帽中央留白给数字
function drawPin(w, h, color) {
  const cx = w / 2, r = w / 2 - 4, capY = w / 2
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  ctx.beginPath()
  ctx.arc(cx, capY, r, Math.PI, 0, false)                    // 上部半圆（钉帽）
  ctx.quadraticCurveTo(cx + r * 0.95, capY + r * 1.1, cx, h) // 右曲线 → 尖端
  ctx.quadraticCurveTo(cx - r * 0.95, capY + r * 1.1, cx - r, capY) // 左曲线
  ctx.closePath()
  ctx.lineWidth = 3
  ctx.strokeStyle = '#ffffff'
  ctx.stroke()
  ctx.fillStyle = color
  ctx.fill()
  // 钉帽中央中空圆环（留白给数字）
  ctx.beginPath()
  ctx.arc(cx, capY, r * 0.5, 0, Math.PI * 2)
  ctx.lineWidth = 4
  ctx.strokeStyle = '#ffffff'
  ctx.stroke()
  return ctx.getImageData(0, 0, w, h)
}

// 各数量档的图钉图片（低/中/高，浅蓝绿色系区分）
function createPinImages() {
  return {
    'pin-low': drawPin(44, 56, '#9ec6da'),   // 数量少：很浅的青
    'pin-mid': drawPin(48, 62, '#5b93ad'),   // 数量中：柔和蓝
    'pin-high': drawPin(54, 70, '#3f7a97'),  // 数量多：较深的蓝（但整体偏浅）
  }
}

// 小图钉（单照片点用，柔和蓝）
function createSmallPinImage() {
  const w = 26, h = 34
  return drawPin(w, h, '#5b93ad')
}

export default function MapPage() {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const readyRef = useRef(false)
  const clusterRef = useRef(null)
  const [photos, setPhotos] = useState([])
  const [hover, setHover] = useState(null)
  const [selected, setSelected] = useState(null)
  const navigate = useNavigate()

  // 根据当前视野和缩放，计算聚合点并更新图层数据
  const updateClusters = useCallback(() => {
    const map = mapRef.current
    const cluster = clusterRef.current
    if (!map || !cluster) return
    const bbox = map.getBounds().toArray().flat()
    const zoom = map.getZoom()
    const clusters = cluster.getClusters(bbox, zoom)
    if (map.getSource('photo-points')) {
      map.getSource('photo-points').setData({ type: 'FeatureCollection', features: clusters })
    }
  }, [])

  // 加载照片，建立聚合索引
  const loadPhotos = useCallback(async () => {
    const map = mapRef.current
    if (!map) return
    try {
      const phs = await fetchPhotos().catch(() => [])
      setPhotos(phs)

      const points = phs
        .filter((p) => p.lat != null && p.lng != null)
        .map((p) => ({
          type: 'Feature',
          properties: {
            cluster: false,
            photoId: p.id,
            province: p.province, city: p.city, county: p.county, name: p.original_name,
          },
          geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
        }))
      if (points.length === 0) return

      const cluster = new Supercluster({ radius: 50, maxZoom: 16 })
      cluster.load(points)
      clusterRef.current = cluster

      if (!map.getSource('photo-points')) {
        map.addSource('photo-points', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })

        // 注册图钉图片（聚合点按数量档用不同颜色/大小的图钉）
        const pinImages = createPinImages()
        for (const [name, img] of Object.entries(pinImages)) {
          if (!map.hasImage(name)) map.addImage(name, img)
        }
        if (!map.hasImage('pin-small')) map.addImage('pin-small', createSmallPinImage())

        // 聚合点：图钉图标（按数量选颜色档）+ 数量数字显示在钉帽中空圆心
        map.addLayer({
          id: 'cluster-pin', type: 'symbol', source: 'photo-points',
          filter: ['has', 'point_count'],
          layout: {
            'icon-image': [
              'match', ['get', 'point_count'],
              20, 'pin-low',
              100, 'pin-mid',
              'pin-high',
            ],
            'icon-size': ['interpolate', ['linear'], ['get', 'point_count'], 2, 0.6, 20, 0.75, 100, 0.95, 500, 1.15],
            'icon-anchor': 'bottom', // 尖端对准坐标
            'text-field': ['get', 'point_count_abbreviated'],
            'text-size': 12,
            'text-offset': [0, 0.15], // 数字居中于钉帽中空圆环
            'text-allow-overlap': true,
            'text-anchor': 'center',
          },
          paint: { 'text-color': '#fff' },
        })
        // 单个照片点：小图钉
        map.addLayer({
          id: 'photo-dot', type: 'symbol', source: 'photo-points',
          filter: ['!', ['has', 'point_count']],
          layout: {
            'icon-image': 'pin-small',
            'icon-size': 0.5,
            'icon-anchor': 'bottom',
          },
        })
      }

      updateClusters()
      map.on('moveend', updateClusters)

      if (!map._hasPinClick) {
        map._hasPinClick = true
        // 点击聚合 → 打开该聚合点覆盖照片的面板
        map.on('click', 'cluster-pin', (e) => {
          const f = e.features[0]
          const leaves = cluster.getLeaves(f.properties.cluster_id)
          const ids = new Set(leaves.map((l) => l.properties.photoId))
          const fullPhotos = phs.filter((p) => ids.has(p.id))
          setSelected({ photos: fullPhotos, label: `${fullPhotos.length} 张照片` })
        })
        // 点击单个照片点 → 打开照片面板
        map.on('click', 'photo-dot', (e) => {
          const f = e.features[0].properties
          setSelected({ filter: { province: f.province, city: f.city, county: f.county } })
        })
        map.on('mouseenter', ['cluster-pin', 'photo-dot'], () => {
          map.getCanvas().style.cursor = 'pointer'
        })
        map.on('mouseleave', ['cluster-pin', 'photo-dot'], () => {
          map.getCanvas().style.cursor = ''
        })
      }
    } catch (e) {
      console.error('loadPhotos failed', e)
    }
  }, [updateClusters])

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

      <PhotoPanel
        filter={selected?.filter}
        photos={selected?.photos}
        label={selected?.label}
        onClose={() => setSelected(null)}
        onDeleted={() => loadPhotosRef.current()}
      />
    </div>
  )
}
