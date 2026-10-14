import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planTimeline, buildAss, ASPECTS } from './video-render.js'

const photo = (id, day, score = 0.8) => ({ id, filename: `p${id}.jpg`, mediaType: 'photo', takenAt: `2024-06-${day}`, score })
const video = (id, day, dur, score = 0.8) => ({ id, filename: `v${id}.mp4`, mediaType: 'video', takenAt: `2024-06-${day}`, duration: dur, score })

test('planTimeline 按拍摄时间升序', () => {
  const r = planTimeline([photo(2, '20'), photo(1, '10')], { targetSeconds: 60 })
  assert.deepEqual(r.map((s) => s.id), [1, 2])
})

test('planTimeline 照片每段 3s、视频片段最多 5s', () => {
  const r = planTimeline([photo(1, '10'), video(2, '11', 9)], { targetSeconds: 60 })
  assert.equal(r[0].duration, 3)
  assert.equal(r[1].duration, 5)
})

test('planTimeline 超出预算时裁掉低分素材', () => {
  const many = Array.from({ length: 40 }, (_, i) => photo(i + 1, '10', i === 5 ? 0.1 : 0.9))
  const r = planTimeline(many, { targetSeconds: 30 })
  assert.ok(r.length < 40)
  assert.ok(!r.some((s) => s.id === 6), '最低分应被裁掉')
})

test('planTimeline 至少保留一个素材', () => {
  const r = planTimeline([photo(1, '10')], { targetSeconds: 1 })
  assert.equal(r.length, 1)
})

test('buildAss 含字体名、地点名与画布尺寸', () => {
  const ass = buildAss({
    placeName: '大理', firstDate: '2024-06-01', lastDate: '2024-06-20', count: 12,
    width: ASPECTS['16:9'].w, height: ASPECTS['16:9'].h, font: 'Noto Sans CJK SC', introDur: 4,
  })
  assert.match(ass, /PlayResX: 1920/)
  assert.match(ass, /PlayResY: 1080/)
  assert.match(ass, /Noto Sans CJK SC/)
  assert.match(ass, /大理/)
  assert.match(ass, /Dialogue:/)
})
