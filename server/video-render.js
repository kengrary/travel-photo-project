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

// 编码器参数：NVENC 用 -cq，CPU 用 -crf
function encodeArgs(encoder) {
  if (encoder.gpu) return ['-c:v', 'h264_nvenc', '-preset', 'p4', '-rc', 'vbr', '-cq', String(encoder.crf), '-b:v', '0']
  return ['-c:v', 'libx264', '-preset', 'medium', '-crf', String(encoder.crf)]
}

// 照片 → 归一化短片：模糊铺底 + 居中适配 + 慢速推近，补静音立体声轨
export function buildPhotoArgs({ src, dest, width, height, duration, fps = FPS }) {
  const frames = Math.max(2, Math.round(duration * fps))
  const fc = [
    `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},gblur=sigma=25[bg]`,
    `[0:v]scale=${width}:${height}:force_original_aspect_ratio=decrease[fg]`,
    `[bg][fg]overlay=(W-w)/2:(H-h)/2,zoompan=z='min(zoom+0.0009,1.2)':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${width}x${height}:fps=${fps},setsar=1,format=yuv420p[v]`,
    `[1:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[a]`,
  ].join(';')
  return [
    '-y', '-i', src, '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
    '-filter_complex', fc, '-map', '[v]', '-map', '[a]',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    '-c:a', 'aac', '-b:a', '128k',
    '-t', String(duration), '-r', String(fps), dest,
  ]
}

// 视频 → 归一化片段：裁剪/缩放至画布，采样率声道统一；无音轨则补静音
export function buildVideoArgs({ src, dest, width, height, duration, hasAudio, fps = FPS }) {
  const vf = `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},fps=${fps},setsar=1,format=yuv420p[v]`
  const args = ['-y', '-i', src]
  let fc
  if (hasAudio) {
    fc = `${vf};[0:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[a]`
  } else {
    args.push('-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo')
    fc = `${vf};[1:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[a]`
  }
  args.push('-filter_complex', fc, '-map', '[v]', '-map', '[a]',
    '-t', String(duration), '-r', String(fps),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', dest)
  return args
}

// 合成：视频 xfade 链 + ass 字幕 + 音频 acrossfade 链 + BGM amix
// assPath 需为相对路径（调用方以临时目录为 cwd 执行，规避 Windows 盘符转义问题）
export function buildConcatArgs({ clips, dest, assPath, width, height, bgm, bgmVolume = 0.5, totalDuration, encoder, fps = FPS }) {
  const n = clips.length
  const inputs = []
  for (const c of clips) inputs.push('-i', c.path)
  let bgmIndex = null
  if (bgm) { inputs.push('-stream_loop', '-1', '-i', bgm); bgmIndex = n }

  const fc = []
  // 视频：逐段 xfade 叠化
  let vprev = '0:v'
  let offset = 0
  for (let i = 1; i < n; i++) {
    offset += clips[i - 1].duration - TRANSITION
    const label = `v${i}`
    fc.push(`[${vprev}][${i}:v]xfade=transition=fade:duration=${TRANSITION}:offset=${offset.toFixed(3)}[${label}]`)
    vprev = label
  }
  let vfinal = n === 1 ? '0:v' : vprev
  if (assPath) {
    fc.push(`[${vfinal}]ass=${assPath}[vout]`)
    vfinal = 'vout'
  }
  // 音频：逐段 acrossfade（与 xfade 重叠一致）
  let aprev = '0:a'
  for (let i = 1; i < n; i++) {
    const label = `a${i}`
    fc.push(`[${aprev}][${i}:a]acrossfade=d=${TRANSITION}:c1=tri:c2=tri[${label}]`)
    aprev = label
  }
  let afinal = n === 1 ? '0:a' : aprev
  if (bgm) {
    fc.push(`[${bgmIndex}:a]volume=${bgmVolume},atrim=0:${(totalDuration).toFixed(3)},asetpts=PTS-STARTPTS[bgm]`)
    fc.push(`[${afinal}][bgm]amix=inputs=2:duration=first:normalize=0[aout]`)
    afinal = 'aout'
  }
  // 单段且未经过滤镜时该流是直通输入，须按流映射（0:v/0:a）而非滤镜标签（[0:v] 会报不存在）
  const vmap = (n === 1 && !assPath) ? '0:v' : `[${vfinal}]`
  const amap = (n === 1 && !bgm) ? '0:a' : `[${afinal}]`
  // 无任何滤镜时不传 -filter_complex（空串会被 ffmpeg 拒绝）
  const filterArgs = fc.length ? ['-filter_complex', fc.join(';')] : []
  return [
    '-y', ...inputs, ...filterArgs,
    '-map', vmap, '-map', amap,
    ...encodeArgs(encoder), '-c:a', 'aac', '-b:a', '160k',
    '-movflags', '+faststart', '-r', String(fps), dest,
  ]
}

// 安全文件名：去掉路径分隔与 Windows 非法字符
function safeName(s) {
  return String(s || '旅行').replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 40) || '旅行'
}

// 探测是否有中文字体（Linux 用 fc-list 尽力而为；缺失仅告警，不阻断）
async function warnIfNoCjkFont(font) {
  if (process.platform !== 'linux') return
  try {
    const { stdout } = await execFileAsync('fc-list', [':lang=zh'])
    if (!stdout.trim()) console.warn(`[成片] 未检测到系统中文字体，字幕可能不显示；可执行 sudo apt install fonts-noto-cjk（当前 fontname=${font}）`)
  } catch { /* 无 fc-list 则跳过 */ }
}

// 两阶段渲染：逐素材归一化 → xfade+ass+amix 合成。返回成片文件名与绝对路径
export async function renderVideo({ assets, placeName, aspect, bgm, length }, onProgress = () => {}) {
  const dims = ASPECTS[aspect] || ASPECTS['16:9']
  const targetSeconds = LENGTHS[length] || LENGTHS.medium
  const font = process.env.VIDEO_FONT || (process.platform === 'win32' ? 'Microsoft YaHei' : 'Noto Sans CJK SC')
  const crf = Number(process.env.VIDEO_CRF) || 20
  await warnIfNoCjkFont(font)

  // 择优：先分析再规划
  onProgress('analyze', 0, assets.length)
  const metrics = await analyzeAssets(assets)
  const byId = new Map(metrics.map((m) => [m.id, m]))
  const scored = assets.map((a) => ({ ...a, score: byId.get(a.id)?.score ?? 0.5 }))
  const timeline = planTimeline(scored, { targetSeconds })
  if (timeline.length === 0) throw new Error('没有可用素材')

  const ff = await resolveFfmpeg()
  const encoder = { gpu: ff.gpu, crf }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'travel-video-'))
  try {
    // 阶段一：逐素材归一化为统一的无声/有声片段
    const clips = []
    for (let i = 0; i < timeline.length; i++) {
      const seg = timeline[i]
      const asset = assets.find((a) => a.id === seg.id)
      const dest = path.join(tmp, `clip-${String(i).padStart(3, '0')}.mp4`)
      if (seg.mediaType === 'video') {
        const hasAudio = await hasAudioStream(asset.mediaPath)
        await execFileAsync(ff.path, buildVideoArgs({ src: asset.mediaPath, dest, width: dims.w, height: dims.h, duration: seg.duration, hasAudio }))
        clips.push({ path: dest, duration: seg.duration, hasAudio })
      } else {
        await execFileAsync(ff.path, buildPhotoArgs({ src: asset.mediaPath, dest, width: dims.w, height: dims.h, duration: seg.duration }))
        clips.push({ path: dest, duration: seg.duration, hasAudio: true })
      }
      onProgress('render', i + 1, timeline.length)
    }

    // 阶段二：合成（assPath 用相对路径 + cwd=tmp）
    const dates = timeline.map((s) => String(s.takenAt || '').slice(0, 10)).filter(Boolean).sort()
    const assFile = path.join(tmp, 'sub.ass')
    fs.writeFileSync(assFile, buildAss({
      placeName, firstDate: dates[0] || '', lastDate: dates[dates.length - 1] || '', count: timeline.length,
      width: dims.w, height: dims.h, font, introDur: 4,
    }))
    onProgress('compose', 0, 1)

    const totalDuration = clips.reduce((s, c) => s + c.duration, 0) - TRANSITION * Math.max(0, clips.length - 1)
    const bgmPath = bgm ? path.join(MUSIC_DIR, bgm) : null
    const name = `${safeName(placeName)}-${Date.now()}.mp4`
    const outputPath = path.join(EXPORTS_DIR, name)
    const args = buildConcatArgs({
      clips, dest: outputPath, assPath: 'sub.ass', width: dims.w, height: dims.h,
      bgm: bgmPath, totalDuration, encoder,
    })
    try {
      await execFileAsync(ff.path, args, { cwd: tmp, maxBuffer: 1024 * 1024 * 16 })
    } catch (e) {
      if (!ff.gpu) throw e
      // NVENC 合成失败：回退 CPU 重编码
      const reason = String(e.stderr || '').split('\n').filter((l) => /Error|error|failed/i.test(l)).slice(-2).join(' | ') || e.message
      console.warn(`[成片] NVENC 合成失败，回退 CPU：${reason}`)
      const cpuArgs = buildConcatArgs({
        clips, dest: outputPath, assPath: 'sub.ass', width: dims.w, height: dims.h,
        bgm: bgmPath, totalDuration, encoder: { gpu: false, crf },
      })
      await execFileAsync(ff.path, cpuArgs, { cwd: tmp, maxBuffer: 1024 * 1024 * 16 })
    }
    onProgress('compose', 1, 1)
    return { name, outputPath }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}
