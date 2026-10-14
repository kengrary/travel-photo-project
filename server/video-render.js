// 旅行成片渲染：时间线规划（纯函数）+ ASS 字幕（纯函数）+ 两阶段 ffmpeg 编排。
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolveFfmpeg, hasAudioStream } from './upload.js'
import { analyzeAssets } from './analyze.js'
import { EXPORTS_DIR, MUSIC_DIR, UPLOAD_DIR } from './paths.js'

const execFileAsync = promisify(execFile)

export const FPS = 30
export const TRANSITION = 0.5       // 转场时长（秒）
export const PER_PHOTO = 3          // 每张照片时长（秒）
export const MAX_VIDEO_CLIP = 5     // 每个视频片段最长（秒）

export const ASPECTS = {
  '16:9': { w: 1920, h: 1080 },
  '9:16': { w: 1080, h: 1920 },
}
export const LENGTHS = { short: 30, medium: 60, long: 120 }

fs.mkdirSync(EXPORTS_DIR, { recursive: true })
fs.mkdirSync(MUSIC_DIR, { recursive: true })

// 时间线规划：按拍摄时间升序、照片 3s、视频最多 5s；超预算时反复裁掉最低分素材
// 返回 [{ id, filename, mediaType, duration, takenAt }]
export function planTimeline(assets, { targetSeconds, perPhoto = PER_PHOTO, maxVideoClip = MAX_VIDEO_CLIP, transition = TRANSITION } = {}) {
  const ordered = [...assets].sort((a, b) => String(a.takenAt || '').localeCompare(String(b.takenAt || '')))
  let segs = ordered.map((a) => ({
    id: a.id, filename: a.filename, mediaType: a.mediaType, takenAt: a.takenAt,
    score: a.score ?? 0.5,
    duration: a.mediaType === 'video' ? Math.min(maxVideoClip, a.duration || maxVideoClip) : perPhoto,
  }))
  const total = () => segs.reduce((s, x) => s + x.duration, 0) - transition * Math.max(0, segs.length - 1)
  while (segs.length > 1 && total() > targetSeconds) {
    let worst = 0
    for (let i = 1; i < segs.length; i++) if (segs[i].score < segs[worst].score) worst = i
    segs = segs.filter((_, i) => i !== worst)
  }
  return segs.map(({ score, ...s }) => s)
}

// 转 ASS 时间戳：H:MM:SS.cc
function assTime(sec) {
  const s = Math.max(0, sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = Math.floor(s % 60)
  const cc = Math.round((s - Math.floor(s)) * 100)
  return `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${String(cc).padStart(2, '0')}`
}

// 生成片头大标题 ASS：地点名 + 日期范围 + 张数
export function buildAss({ placeName, firstDate, lastDate, count, width, height, font, introDur = 4 }) {
  const range = firstDate === lastDate ? firstDate : `${firstDate} — ${lastDate}`
  const subtitle = `${range} · ${count} 张`
  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Title,${font},${Math.round(height / 14)},&H00FFFFFF,&H000000FF,&H96000000,&H64000000,-1,0,0,0,100,100,0,0,1,3,1,2,60,60,${Math.round(height / 8)},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,${assTime(0)},${assTime(introDur)},Title,,0,0,0,,${placeName}\\N{\\fs${Math.round(height / 30)}}${subtitle}
`
}
