import { Routes, Route, Link } from 'react-router-dom'
import MapPage from './pages/MapPage.jsx'
import WallPage from './pages/WallPage.jsx'
import UploadPage from './pages/UploadPage.jsx'

export default function App() {
  return (
    <div style={{ height: '100%' }}>
      <nav style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10, display: 'flex', gap: 16, padding: 12, background: 'rgba(255,255,255,0.9)' }}>
        <Link to="/">地图</Link>
        <Link to="/wall">照片墙</Link>
        <Link to="/upload">上传</Link>
      </nav>
      <Routes>
        <Route path="/" element={<MapPage />} />
        <Route path="/wall" element={<WallPage />} />
        <Route path="/upload" element={<UploadPage />} />
      </Routes>
    </div>
  )
}
