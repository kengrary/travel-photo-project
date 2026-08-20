import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import maplibregl from 'maplibre-gl'
import { uploadPhotos, setPhotoLocation } from '../api.js'

const BASE_STYLE = 'https://demotiles.maplibre.org/style.json'

export default function UploadPage() {
  const [files, setFiles] = useState([])
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState([])
  const [manualTarget, setManualTarget] = useState(null) // 待手动定位的照片
  const [map, setMap] = useState(null)
  const mapContainer = useRef(null)
  const markerRef = useRef(null)
  const navigate = useNavigate()

  const onSelect = (e) => setFiles([...e.target.files])

  const doUpload = async () => {
    setUploading(true)
    const photos = await uploadPhotos(files)
    setResult(photos)
    setUploading(false)
    // 有未定位照片时，进入手动定位
    const needs = photos.filter((p) => !p.province)
    if (needs.length) { setManualTarget(needs[0]); openMap() }
  }

  const openMap = () => {
    if (map) return
    const m = new maplibregl.Map({ container: mapContainer.current, style: BASE_STYLE, center: [104.195, 35.861], zoom: 3.5 })
    m.on('click', (e) => {
      if (markerRef.current) markerRef.current.remove()
      markerRef.current = new maplibregl.Marker().setLngLat(e.lngLat).addTo(m)
      setManualTarget((t) => (t ? { ...t, _lat: e.lngLat.lat, _lng: e.lngLat.lng } : t))
    })
    setMap(m)
  }

  const confirmLocation = async () => {
    if (!manualTarget || manualTarget._lat == null) return
    await setPhotoLocation(manualTarget.id, { lat: manualTarget._lat, lng: manualTarget._lng })
    alert('已更新地点')
    setManualTarget(null)
  }

  return (
    <div style={{ paddingTop: 48, padding: 16 }}>
      <h2>上传照片</h2>
      <input type="file" multiple accept="image/*" onChange={onSelect} />
      <button onClick={doUpload} disabled={uploading || files.length === 0} style={{ marginLeft: 12 }}>
        {uploading ? '上传中…' : '上传'}
      </button>
      <button onClick={() => navigate('/wall')} style={{ marginLeft: 12 }}>查看照片墙</button>

      {manualTarget && (
        <div style={{ marginTop: 16 }}>
          <p>「{manualTarget.original_name}」未自动定位，请在地图上点击位置：</p>
          <div ref={mapContainer} style={{ width: '100%', height: 400, marginTop: 8 }} />
          <button onClick={confirmLocation} style={{ marginTop: 8 }} disabled={manualTarget._lat == null}>确认此地点</button>
        </div>
      )}

      {result.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <h3>上传结果</h3>
          {result.map((p, i) => (
            <p key={i}>
              {p.original_name}: {p.error ? `失败 ${p.error}` : `已定位 ${p.province || ''} ${p.city || ''} ${p.county || ''}`}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
