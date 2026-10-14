import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import sharp from 'sharp'
import { toGray, dHash, hammingDistance, laplacianVariance, exposureRatio, analyzeAssets } from './analyze.js'

test('toGray 单通道原样返回，多通道按亮度加权', () => {
  assert.deepEqual([...toGray(new Uint8Array([10, 20, 30]), 1, 1, 3)], [18])
})

test('dHash 相同图像距离为 0', () => {
  const g = new Uint8Array(9 * 8)
  for (let i = 0; i < g.length; i++) g[i] = (i % 9) * 28
  const h = dHash(g, 9, 8)
  assert.equal(h.length, 16)
  assert.equal(hammingDistance(h, h), 0)
})

test('dHash 对反转梯度产生非零距离', () => {
  const a = new Uint8Array(9 * 8)
  const b = new Uint8Array(9 * 8)
  for (let i = 0; i < a.length; i++) { a[i] = (i % 9) * 28; b[i] = (8 - (i % 9)) * 28 }
  assert.ok(hammingDistance(dHash(a, 9, 8), dHash(b, 9, 8)) > 0)
})

test('laplacianVariance 平坦图接近 0，棋盘图显著更大', () => {
  const flat = new Uint8Array(8 * 8).fill(128)
  const checker = new Uint8Array(8 * 8)
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) checker[y * 8 + x] = (x + y) % 2 ? 0 : 255
  assert.ok(laplacianVariance(flat, 8, 8) < 1)
  assert.ok(laplacianVariance(checker, 8, 8) > laplacianVariance(flat, 8, 8))
})

test('exposureRatio 全黑为 1，中灰为 0', () => {
  assert.equal(exposureRatio(new Uint8Array(16).fill(0)), 1)
  assert.equal(exposureRatio(new Uint8Array(16).fill(128)), 0)
})

test('analyzeAssets 返回评分字段且 0..1', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'analyze-'))
  const p = path.join(dir, 'x.jpg')
  await sharp({ create: { width: 60, height: 40, channels: 3, background: { r: 120, g: 120, b: 120 } } }).jpeg().toFile(p)
  const r = await analyzeAssets([{ id: 1, filename: 'x.jpg', imagePath: p }])
  assert.equal(r.length, 1)
  assert.ok(r[0].score >= 0 && r[0].score <= 1)
  assert.equal(r[0].phash.length, 16)
  fs.rmSync(dir, { recursive: true, force: true })
})
