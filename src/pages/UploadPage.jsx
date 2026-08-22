import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { uploadPhotos, setPhotoLocation, reverseGeocode } from '../api.js'

// 高德中文栅格瓦片（与主地图一致，选点时能看到中文地名）
const GAODE_TILES = [
  'https://webrd01.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
  'https://webrd02.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
  'https://webrd03.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
  'https://webrd04.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
]
const GAODE_STYLE = {
  version: 8,
  sources: {
    gaode: { type: 'raster', tiles: GAODE_TILES, tileSize: 256, maxzoom: 18, attribution: '© 高德地图' },
  },
  layers: [{ id: 'gaode-base', type: 'raster', source: 'gaode' }],
}

export default function UploadPage() {
  const [files, setFiles] = useState([])
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState([])
  const [manualTarget, setManualTarget] = useState(null)
  const [locateQueue, setLocateQueue] = useState([]) // 等待手动定位的照片队列
  const [picked, setPicked] = useState(null)
  const mapRef = useRef(null)
  const mapContainer = useRef(null)
  const markerRef = useRef(null)
  const fileInput = useRef(null)
  const locateQueueRef = useRef([]) // 与 locateQueue 同步，回调里读最新值
  const navigate = useNavigate()

  // 当前这张定位完成/跳过后，自动进入队列中的下一张
  const advanceLocate = (currentId) => {
    const rest = locateQueueRef.current.filter((p) => p.id !== currentId)
    locateQueueRef.current = rest
    setLocateQueue(rest)
    setManualTarget(rest[0] || null)
    setPicked(null)
  }

  // 从结果列表重新打开某张的定位地图
  const reopenLocate = (p) => {
    setManualTarget(p)
    setPicked(null)
  }

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
      locateQueueRef.current = needs
      setLocateQueue(needs)
      if (needs.length) {
        setManualTarget(needs[0])
        setPicked(null)
      }
      // 上传完成后清空已选文件，防止重复上传
      setFiles([])
      if (fileInput.current) fileInput.current.value = ''
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
      style: GAODE_STYLE,
      center: [104.195, 35.861],
      zoom: 3.5,
    })
    mapRef.current = map
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')
    map.on('click', async (e) => {
      if (markerRef.current) markerRef.current.remove()
      markerRef.current = new maplibregl.Marker({ color: '#c2402f' }).setLngLat(e.lngLat).addTo(map)
      setManualTarget((t) => (t ? { ...t, _lat: e.lngLat.lat, _lng: e.lngLat.lng } : t))
      // 反查并显示选中位置的省市县
      try {
        const r = await reverseGeocode(e.lngLat.lat, e.lngLat.lng)
        setPicked(r)
      } catch {
        setPicked(null)
      }
    })
    return () => {
      map.remove()
      mapRef.current = null
      markerRef.current = null
    }
  }, [targetId])

  const confirmLocation = async () => {
    if (!manualTarget || manualTarget._lat == null) return
    try {
      const photo = await setPhotoLocation(manualTarget.id, { lat: manualTarget._lat, lng: manualTarget._lng })
      // 更新结果列表中的该照片为已定位
      if (photo && photo.province) {
        setResult((list) => list.map((p) => (p.id === photo.id ? { ...p, ...photo } : p)))
      }
    } catch (err) {
      alert(`定位失败：${err.message}`)
    }
    advanceLocate(manualTarget.id)
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
          accept="image/*,.heic,.heif,.mov,.mp4"
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
            {locateQueue.length > 1 && <>待定位 {locateQueue.length} 张 · </>}
            照片「<b style={{ color: 'var(--ink)' }}>{manualTarget.original_name}</b>」无法自动定位，请在地图上点击它的拍摄位置：
          </p>
          <div ref={mapContainer} style={{ width: '100%', height: 420, borderRadius: 'var(--radius)', overflow: 'hidden' }} />
          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span className="chip" style={{ padding: '6px 12px' }}>
              {picked
                ? `已选位置：${[picked.province, picked.city, picked.county].filter(Boolean).join(' ') || '未识别'}`
                : '在地图上点击选择位置'}
            </span>
            <button className="btn btn-primary" onClick={confirmLocation} disabled={manualTarget._lat == null}>
              确认此地点
            </button>
            <button className="btn btn-ghost" onClick={() => advanceLocate(manualTarget.id)}>
              跳过此张
            </button>
          </div>
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
                      : (
                        <>
                          已上传，等待手动定位
                          {p.id && (
                            <button
                              className="btn btn-ghost"
                              style={{ marginLeft: 8, padding: '2px 10px', fontSize: 12 }}
                              onClick={() => reopenLocate(p)}
                            >
                              定位
                            </button>
                          )}
                        </>
                      )}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
