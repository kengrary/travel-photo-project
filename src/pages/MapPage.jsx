import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { fetchLocations } from '../api.js'

const CENTER = [104.195, 35.861]
const BASE_STYLE = 'https://demotiles.maplibre.org/style.json' // 免费矢量底图

export default function MapPage() {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const [locations, setLocations] = useState([])
  const navigate = useNavigate()

  useEffect(() => {
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASE_STYLE,
      center: CENTER,
      zoom: 3.5,
    })
    mapRef.current = map

    map.on('load', async () => {
      const locs = await fetchLocations()
      setLocations(locs)

      const res = await fetch('/data/100000_full.json')
      const geojson = await res.json()

      map.addSource('provinces', { type: 'geojson', data: geojson })
      map.addLayer({
        id: 'province-fill',
        type: 'fill',
        source: 'provinces',
        paint: { 'fill-color': '#cccccc', 'fill-opacity': 0.5 },
      })
      map.addLayer({
        id: 'province-line',
        type: 'line',
        source: 'provinces',
        paint: { 'line-color': '#888', 'line-width': 1 },
      })

      map.on('click', 'province-fill', (e) => {
        const name = e.features[0].properties.name
        navigate(`/wall?province=${encodeURIComponent(name)}`)
      })
      map.on('mouseenter', 'province-fill', () => (map.getCanvas().style.cursor = 'pointer'))
      map.on('mouseleave', 'province-fill', () => (map.getCanvas().style.cursor = ''))
    })

    return () => map.remove()
  }, [navigate])

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      <div style={{ position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 5 }}>
        <button onClick={() => navigate('/upload')} style={{ padding: '10px 20px', fontSize: 16 }}>上传照片</button>
      </div>
    </div>
  )
}
