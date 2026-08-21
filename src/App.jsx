import { Routes, Route, NavLink } from 'react-router-dom'
import MapPage from './pages/MapPage.jsx'
import WallPage from './pages/WallPage.jsx'
import UploadPage from './pages/UploadPage.jsx'
import TimelinePage from './pages/TimelinePage.jsx'
import './app.css'

export default function App() {
  return (
    <div style={{ height: '100%' }}>
      <header className="appbar">
        <div className="appbar-brand">
          足迹地图册 <small>atlas · cn</small>
        </div>
        <nav className="appbar-nav">
          <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')}>地图</NavLink>
          <NavLink to="/wall" className={({ isActive }) => (isActive ? 'active' : '')}>照片墙</NavLink>
          <NavLink to="/timeline" className={({ isActive }) => (isActive ? 'active' : '')}>时间轴</NavLink>
          <NavLink to="/upload" className={({ isActive }) => (isActive ? 'active' : '')}>上传</NavLink>
        </nav>
      </header>
      <Routes>
        <Route path="/" element={<MapPage />} />
        <Route path="/wall" element={<WallPage />} />
        <Route path="/timeline" element={<TimelinePage />} />
        <Route path="/upload" element={<UploadPage />} />
      </Routes>
    </div>
  )
}
