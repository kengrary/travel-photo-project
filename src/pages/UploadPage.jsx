import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { uploadPhotos, setPhotoLocation } from '../api.js'

const BASE_STYLE = 'https://demotiles.maplibre.org/style.json'

export default function UploadPage() {
  const [files, setFiles] = useState([])
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState([])
  const [manualTarget, setManualTarget] = useState(null)
  const mapRef = useRef(null)
  const mapContainer = useRef(null)
  const markerRef = useRef(null)
  const fileInput = useRef(null)
  const navigate = useNavigate()

  const onSelect = (e) => setFiles([...e.target.files])
  const onDrop = (e) => {
    e.preventDefault()
    setDragging(false)
    if (e.dataTransfer.files?.length) setFiles([...e.dataTransfer.files])
  }

  const doUpload = async () => {
    setUploading(true)
    try {
      const photos = await uploadPhotos(files)
      setResult(photos)
      const needs = photos.filter((p) => p.id && !p.province)
      if (needs.length) setManualTarget(needs[0])
    } catch (err) {
      alert(`上传失败：${err.message}`)
    } finally {
      setUploading(false)
    }
  }

  const targetId = manualTarget && manualTarget.id
  useEffect(() => {
    if (!targetId) return
    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: BASE_STYLE,
      center: [104.195, 35.861],
      zoom: 3.5,
    })
    mapRef.current = map
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')
    map.on('click', (e) => {
      if (markerRef.current) markerRef.current.remove()
      markerRef.current = new maplibregl.Marker({ color: '#c2402f' }).setLngLat(e.lngLat).addTo(map)
      setManualTarget((t) => (t ? { ...t, _lat: e.lngLat.lat, _lng: e.lngLat.lng } : t))
    })
    return () => {
      map.remove()
      mapRef.current = null
      markerRef.current = null
    }
  }, [targetId])

  const confirmLocation = async () => {
    if (!manualTarget || manualTarget._lat == null) return
    await setPhotoLocation(manualTarget.id, { lat: manualTarget._lat, lng: manualTarget._lng })
    alert('已更新地点')
    setManualTarget(null)
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">add to the atlas</div>
          <h1 className="page-title">上传照片</h1>
          <p className="page-sub">选择照片，自动按 GPS 定位到拍摄的省市县；无法自动定位的可在图上手动点选。</p>
        </div>
      </div>

      <div
        className={dragging ? 'drop drag' : 'drop'}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => fileInput.current?.click()}
      >
        <input
          ref={fileInput}
          type="file" multiple
          accept="image/*,.heic,.heif"
          onChange={onSelect} style={{ display: 'none' }}
        />
        <div className="drop-label">
          <b>点击选择</b> 或 <b>拖拽照片</b> 到这里（支持多选）
        </div>
        {files.length > 0 && (
          <div style={{ marginTop: 14, textAlign: 'left', maxHeight: 180, overflow: 'auto' }}>
            {[...files].map((f, i) => (
              <div key={i} className="file-pill">
                <span>{f.name}</span>
                <span style={{ color: 'var(--ink-soft)', fontSize: 12 }}>{(f.size / 1024).toFixed(0)} KB</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
        <button className="btn btn-primary" onClick={doUpload} disabled={uploading || files.length === 0}>
          {uploading ? '上传中…' : `上传 ${files.length || ''} 张照片`.trim()}
        </button>
        <button className="btn btn-ghost" onClick={() => navigate('/wall')}>查看照片墙</button>
      </div>

      {manualTarget && (
        <div style={{ marginTop: 26 }}>
          <p className="page-sub" style={{ marginBottom: 8 }}>
            照片「<b style={{ color: 'var(--ink)' }}>{manualTarget.original_name}</b>」无法自动定位，请在地图上点击它的拍摄位置：
          </p>
          <div ref={mapContainer} style={{ width: '100%', height: 420, borderRadius: 'var(--radius)', overflow: 'hidden' }} />
          <button className="btn btn-primary" onClick={confirmLocation} style={{ marginTop: 12 }} disabled={manualTarget._lat == null}>
            确认此地点
          </button>
        </div>
      )}

      {result.length > 0 && (
        <div style={{ marginTop: 26 }}>
          <h2 className="page-title" style={{ fontSize: 18, marginBottom: 12 }}>上传结果</h2>
          <div className="photogrid" style={{ gridTemplateColumns: '1fr' }}>
            {result.map((p, i) => (
              <div key={i} className="file-pill">
                <span>{p.original_name}</span>
                <span style={{ color: 'var(--ink-soft)', fontSize: 13 }}>
                  {p.error
                    ? `定位失败：${p.error}`
                    : p.province
                      ? `已定位 ${p.province} ${p.city || ''} ${p.county || ''}`
                      : '已上传，等待手动定位'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
