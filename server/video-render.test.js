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

import { buildPhotoArgs, buildVideoArgs, buildConcatArgs } from './video-render.js'

test('buildPhotoArgs 用 zoompan 做运镜、补静音轨、限时长', () => {
  const a = buildPhotoArgs({ src: 'p.jpg', dest: 'c.mp4', width: 1920, height: 1080, duration: 3 })
  assert.ok(a.includes('-i') && a.includes('p.jpg'))
  const fc = a[a.indexOf('-filter_complex') + 1]
  assert.match(fc, /zoompan/)
  assert.match(fc, /anullsrc|1:a|0:a|1:v/)
  assert.equal(a[a.indexOf('-t') + 1], '3')
  assert.equal(a[a.length - 1], 'c.mp4')
})

test('buildVideoArgs 有音轨时映射 [a]，无音轨时补 anullsrc', () => {
  const withA = buildVideoArgs({ src: 'v.mp4', dest: 'c.mp4', width: 1080, height: 1920, duration: 4, hasAudio: true })
  assert.ok(withA.includes('[a]'))
  assert.ok(!withA.includes('anullsrc'))
  const noA = buildVideoArgs({ src: 'v.mp4', dest: 'c.mp4', width: 1080, height: 1920, duration: 4, hasAudio: false })
  assert.ok(noA.some((x) => String(x).includes('anullsrc')))
})

test('buildConcatArgs 两段含 xfade/acrossfade，配 BGM 含 amix 与 stream_loop', () => {
  const clips = [{ path: 'a.mp4', duration: 3, hasAudio: true }, { path: 'b.mp4', duration: 3, hasAudio: true }]
  const a = buildConcatArgs({
    clips, dest: 'out.mp4', assPath: 'sub.ass', width: 1920, height: 1080,
    bgm: '/m/song.mp3', bgmVolume: 0.5, totalDuration: 5.5, encoder: { gpu: false, crf: 20 },
  })
  const fc = a.filter((x, i) => a[i - 1] === '-filter_complex')[0]
  assert.match(fc, /xfade/)
  assert.match(fc, /acrossfade/)
  assert.match(fc, /amix/)
  assert.ok(a.includes('-stream_loop'))
  assert.equal(a[a.length - 1], 'out.mp4')
})
