import { useEffect, useState } from 'react'
import { listVideos, deleteVideo, videoUrl } from '../api.js'

function fmtSize(n) {
  if (!n) return '0'
  if (n > 2 ** 20) return (n / 2 ** 20).toFixed(0) + ' MB'
  return Math.max(1, Math.round(n / 2 ** 10)) + ' KB'
}

export default function VideosPage() {
  const [videos, setVideos] = useState([])

  const load = () => listVideos().then(setVideos).catch(() => setVideos([]))
  useEffect(() => { load() }, [])

  const remove = async (name) => {
    if (!window.confirm(`删除成片「${name}」？`)) return
    await deleteVideo(name)
    load()
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">travel films</div>
          <h1 className="page-title">我的成片</h1>
          <p className="page-sub">在地图上点开某个地点，即可一键生成旅行视频；生成的成片都保存在这里。</p>
        </div>
      </div>

      {videos.length === 0 ? (
        <div className="empty">
          <div className="empty-title">还没有成片</div>
          <p>去地图点击一个地点聚类，选择"生成旅行视频"。</p>
        </div>
      ) : (
        <div className="videos-grid">
          {videos.map((v) => (
            <div key={v.name} className="video-card">
              <video src={videoUrl(v.name)} controls preload="metadata" />
              <div className="video-card-meta">
                <span className="video-card-name" title={v.name}>{v.name}</span>
                <span className="video-card-sub">{fmtSize(v.size)}</span>
              </div>
              <div className="video-card-actions">
                <a className="btn btn-ghost" href={videoUrl(v.name)} download={v.name}>下载</a>
                <button className="btn btn-ghost" onClick={() => remove(v.name)}>删除</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
