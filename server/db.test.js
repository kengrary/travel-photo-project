import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openDb, insertPhoto, listPhotos, countByLocation, getPhoto, updateLocation, deletePhoto } from './db.js'

function makeDb() {
  return openDb(':memory:')
}

test('insert and get photo', () => {
  const db = makeDb()
  const p = insertPhoto(db, {
    filename: 'a.jpg', original_name: 'a.jpg', thumb_path: 't/a.jpg',
    taken_at: '2024-01-01T00:00:00Z', lat: 23.1, lng: 113.2,
    province: '广东省', city: '广州市', county: '天河区', location_name: null,
    created_at: '2024-01-02T00:00:00Z',
  })
  assert.ok(p.id)
  assert.equal(getPhoto(db, p.id).city, '广州市')
})

test('list filters by province', () => {
  const db = makeDb()
  insertPhoto(db, { filename: 'a.jpg', province: '广东省', created_at: 'x' })
  insertPhoto(db, { filename: 'b.jpg', province: '浙江省', created_at: 'y' })
  const rows = listPhotos(db, { province: '广东省' })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].filename, 'a.jpg')
})

test('count by location', () => {
  const db = makeDb()
  insertPhoto(db, { filename: 'a.jpg', province: '广东省', city: '广州市', county: '天河区', created_at: 'x' })
  insertPhoto(db, { filename: 'b.jpg', province: '广东省', city: '广州市', county: '天河区', created_at: 'y' })
  insertPhoto(db, { filename: 'c.jpg', province: '广东省', city: '深圳市', county: '', created_at: 'z' })
  const counts = countByLocation(db)
  assert.deepEqual(counts.find((r) => r.county === '天河区').count, 2)
})

test('update location', () => {
  const db = makeDb()
  const p = insertPhoto(db, { filename: 'a.jpg', province: null, created_at: 'x' })
  const updated = updateLocation(db, p.id, { lat: 1, lng: 2, province: '广东省', city: '广州市', county: '', location_name: '珠江新城' })
  assert.equal(updated.location_name, '珠江新城')
})

test('delete photo returns the row and removes it', () => {
  const db = makeDb()
  const p = insertPhoto(db, { filename: 'a.jpg', province: '广东省', created_at: 'x' })
  const removed = deletePhoto(db, p.id)
  assert.equal(removed.id, p.id)
  assert.equal(getPhoto(db, p.id), undefined)
  assert.equal(deletePhoto(db, 999), null)
})
