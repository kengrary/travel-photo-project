import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const GEO_DIR = path.resolve(__dirname, 'data/geojson')

// 射线法 point-in-polygon（支持 ring 数组 [ [lng,lat], ... ]）
function pointInRing(lng, lat, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1]
    const xj = ring[j][0], yj = ring[j][1]
    const intersect = ((yi > lat) !== (yj > lat)) &&
      (lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi)
    if (intersect) inside = !inside
  }
  return inside
}

function pointInPolygon(lng, lat, coords) {
  // coords 可能是 ring、Polygon [rings] 或 MultiPolygon [polygons]，逐层判断
  if (typeof coords[0][0] === 'number') {
    // 单个 ring
    return pointInRing(lng, lat, coords)
  }
  if (typeof coords[0][0][0] === 'number') {
    // Polygon：rings[]，用 even-odd 规则同时处理外环与洞
    let inside = false
    for (const ring of coords) {
      if (pointInRing(lng, lat, ring)) inside = !inside
    }
    return inside
  }
  // MultiPolygon：对每个 polygon 判断，任一命中即命中
  for (const poly of coords) {
    if (pointInPolygon(lng, lat, poly)) return true
  }
  return false
}

function featureContains(feature, lng, lat) {
  return pointInPolygon(lng, lat, feature.geometry.coordinates)
}

class GeoIndex {
  constructor() { this.provinces = [] }

  load() {
    const provFile = path.join(GEO_DIR, '100000_full.json')
    this.provinces = JSON.parse(fs.readFileSync(provFile, 'utf8')).features
  }

  // 给定省 adcode，读取该省的城市层文件并定位
  locateProvince(lng, lat) {
    for (const prov of this.provinces) {
      if (featureContains(prov, lng, lat)) return prov.properties
    }
    return null
  }

  locateChildren(parentAdcode, lng, lat) {
    const file = path.join(GEO_DIR, `${parentAdcode}_full.json`)
    if (!fs.existsSync(file)) return null
    const fc = JSON.parse(fs.readFileSync(file, 'utf8'))
    for (const feat of fc.features) {
      if (featureContains(feat, lng, lat)) return feat.properties
    }
    return null
  }
}

export function loadGeoIndex() {
  const idx = new GeoIndex()
  idx.load()
  return idx
}

// 返回 {province, city, county}
export function reverseGeocode(geo, lng, lat) {
  const prov = geo.locateProvince(lng, lat)
  if (!prov) return { province: null, city: null, county: null }

  const isMunicipality = ['110000', '120000', '310000', '500000'].includes(String(prov.adcode))
  const provName = prov.name

  const child = geo.locateChildren(prov.adcode, lng, lat)
  if (!child) return { province: provName, city: null, county: null }

  if (isMunicipality) {
    // 直辖市：child 是区县，city = 直辖市名
    return { province: provName, city: provName, county: child.name }
  }

  // 省级：child 是市，继续查县的边界文件
  const county = geo.locateChildren(child.adcode, lng, lat)
  return {
    province: provName,
    city: child.name,
    county: county ? county.name : '',
  }
}
