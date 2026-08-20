import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadGeoIndex, reverseGeocode } from './geocode.js'

const geo = loadGeoIndex()

test('reverse geocode Beijing (municipality district)', () => {
  // 北京市东城区中心附近
  const r = reverseGeocode(geo, 116.418, 39.917)
  assert.equal(r.province, '北京市')
  assert.equal(r.city, '北京市')
  assert.ok(r.county)
})

test('reverse geocode Guangdong Guangzhou (province + city + county)', () => {
  // 广州市天河区中心附近
  const r = reverseGeocode(geo, 113.36, 23.12)
  assert.equal(r.province, '广东省')
  assert.equal(r.city, '广州市')
  assert.ok(r.county)
})

test('reverse geocode empty ocean returns nulls', () => {
  const r = reverseGeocode(geo, 130, 10)
  assert.equal(r.province, null)
})
