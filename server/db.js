import Database from 'better-sqlite3'
import path from 'node:path'
import fs from 'node:fs'
import { DB_PATH as DEFAULT_DB_PATH } from './paths.js'

export function openDb(dbPath = DEFAULT_DB_PATH) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT UNIQUE NOT NULL,
      original_name TEXT,
      thumb_path TEXT,
      full_path TEXT,
      taken_at TEXT,
      lat REAL,
      lng REAL,
      province TEXT,
      city TEXT,
      county TEXT,
      location_name TEXT,
      origin_path TEXT,
      size_bytes INTEGER,
      rotate_deg INTEGER DEFAULT 0,
      media_type TEXT DEFAULT 'photo',
      duration REAL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_photos_taken ON photos(taken_at);
    CREATE INDEX IF NOT EXISTS idx_photos_loc ON photos(province, city, county);
  `)
  // 迁移：旧库补充 full_path / origin_path / size_bytes / rotate_deg / media_type / duration 列
  const cols = db.prepare(`PRAGMA table_info(photos)`).all().map((c) => c.name)
  if (!cols.includes('full_path')) db.exec(`ALTER TABLE photos ADD COLUMN full_path TEXT`)
  if (!cols.includes('origin_path')) db.exec(`ALTER TABLE photos ADD COLUMN origin_path TEXT`)
  if (!cols.includes('size_bytes')) db.exec(`ALTER TABLE photos ADD COLUMN size_bytes INTEGER`)
  if (!cols.includes('rotate_deg')) db.exec(`ALTER TABLE photos ADD COLUMN rotate_deg INTEGER DEFAULT 0`)
  if (!cols.includes('media_type')) db.exec(`ALTER TABLE photos ADD COLUMN media_type TEXT DEFAULT 'photo'`)
  if (!cols.includes('duration')) db.exec(`ALTER TABLE photos ADD COLUMN duration REAL`)
  return db
}

export function insertPhoto(db, photo) {
  const stmt = db.prepare(`
    INSERT INTO photos (filename, original_name, thumb_path, full_path, taken_at, lat, lng, province, city, county, location_name, origin_path, size_bytes, rotate_deg, media_type, duration, created_at)
    VALUES (@filename, @original_name, @thumb_path, @full_path, @taken_at, @lat, @lng, @province, @city, @county, @location_name, @origin_path, @size_bytes, @rotate_deg, @media_type, @duration, @created_at)
  `)
  const info = stmt.run({
    original_name: null, thumb_path: null, full_path: null, taken_at: null, lat: null, lng: null,
    province: null, city: null, county: null, location_name: null, origin_path: null, size_bytes: null,
    rotate_deg: 0, media_type: 'photo', duration: null,
    ...photo,
  })
  return getPhoto(db, info.lastInsertRowid)
}

export function getPhoto(db, id) {
  return db.prepare('SELECT * FROM photos WHERE id = ?').get(id)
}

// 按筛选条件构造 WHERE 子句与参数（listPhotos / countPhotos 共用）
function buildWhere(filter = {}) {
  const conds = []
  const params = {}
  if (filter.province) { conds.push('province = @province'); params.province = filter.province }
  if (filter.city) { conds.push('city = @city'); params.city = filter.city }
  if (filter.county) { conds.push('county = @county'); params.county = filter.county }
  // 关键词：匹配文件名/地点名/省市县
  if (filter.q) {
    conds.push('(original_name LIKE @q OR location_name LIKE @q OR province LIKE @q OR city LIKE @q OR county LIKE @q)')
    params.q = `%${filter.q}%`
  }
  // 时间段：按日期部分（YYYY-MM-DD）比较，含边界日
  if (filter.from) { conds.push('substr(taken_at, 1, 10) >= @from'); params.from = filter.from }
  if (filter.to) { conds.push('substr(taken_at, 1, 10) <= @to'); params.to = filter.to }
  return { whereSql: conds.length ? 'WHERE ' + conds.join(' AND ') : '', params }
}

export function listPhotos(db, filter = {}) {
  const { whereSql, params } = buildWhere(filter)
  // 分页：limit>0 时生效，offset 缺省为 0（数字强转防注入）
  const limitSql = filter.limit > 0 ? ` LIMIT ${Math.floor(Number(filter.limit))} OFFSET ${Math.floor(Number(filter.offset) || 0)}` : ''
  const order = filter.orderBy === 'location' ? 'province, city, county, taken_at DESC' : 'taken_at DESC'
  return db.prepare(`SELECT * FROM photos ${whereSql} ORDER BY ${order}${limitSql}`).all(params)
}

export function countPhotos(db, filter = {}) {
  const { whereSql, params } = buildWhere(filter)
  return db.prepare(`SELECT COUNT(*) AS n FROM photos ${whereSql}`).get(params).n
}

export function updateLocation(db, id, loc) {
  const stmt = db.prepare(`
    UPDATE photos SET lat=@lat, lng=@lng, province=@province, city=@city, county=@county, location_name=@location_name
    WHERE id=@id
  `)
  stmt.run({ id, ...loc })
  return getPhoto(db, id)
}

// 通用元数据更新（拖拽补位置/补时间用）：仅更新传入的字段
export function updatePhotoMeta(db, id, fields) {
  const photo = getPhoto(db, id)
  if (!photo) return null
  const allowed = ['province', 'city', 'county', 'taken_at']
  const sets = []
  const params = { id }
  for (const key of allowed) {
    if (key in fields) { sets.push(`${key} = @${key}`); params[key] = fields[key] }
  }
  if (sets.length === 0) return photo
  db.prepare(`UPDATE photos SET ${sets.join(', ')} WHERE id = @id`).run(params)
  return getPhoto(db, id)
}

export function deletePhoto(db, id) {
  const photo = getPhoto(db, id)
  if (!photo) return null
  db.prepare('DELETE FROM photos WHERE id = ?').run(id)
  return photo
}
