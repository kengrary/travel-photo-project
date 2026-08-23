import multer from 'multer'
import path from 'node:path'
import fs from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import sharp from 'sharp'
import heicDecode from 'heic-decode'
import ffmpegPath from 'ffmpeg-static'
import ffprobePath from 'ffprobe-static'
import { UPLOAD_DIR as UPLOADS_DIR, BASE_DIR } from './paths.js'

const execFileAsync = promisify(execFile)

const UPLOAD_DIR = UPLOADS_DIR
const THUMB_DIR = path.join(UPLOAD_DIR, 'thumbs')
const FULL_DIR = path.join(UPLOAD_DIR, 'full')
fs.mkdirSync(THUMB_DIR, { recursive: true })
fs.mkdirSync(FULL_DIR, { recursive: true })

export const uploadDir = UPLOAD_DIR

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg'
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`)
  },
})

export const upload = multer({ storage, limits: { fileSize: 30 * 1024 * 1024 } })

// sharp 预编译版不含 HEVC/HEIC 解码器，需先用 heic-decode 转成原始像素
async function loadImage(src) {
  const lower = src.toLowerCase()
  const isHeic = lower.endsWith('.heic') || lower.endsWith('.heif')
  if (!isHeic) return sharp(src)
  const { data, width, height } = await heicDecode({ buffer: fs.readFileSync(src) })
  return sharp(data, { raw: { width, height, channels: 4 } })
}

// 生成缩略图与大图。sourcePath 为原图路径；缩略图/大图写入 uploads 下
// （默认 sourcePath = UPLOAD_DIR/filename，兼容既有调用）
export async function makeThumb(filename, sourcePath = path.join(UPLOAD_DIR, filename)) {
  const img = await loadImage(sourcePath)
  const base = path.basename(filename)
  const thumbName = `thumb-${base}`
  const fullName = `full-${base}`
  await img.clone().resize({ width: 600, withoutEnlargement: true }).jpeg({ quality: 80 }).toFile(path.join(THUMB_DIR, thumbName))
  // 大图统一转为 JPEG（浏览器可直接显示，解决 HEIC 大图打不开）
  await img.resize({ width: 1600, withoutEnlargement: true }).jpeg({ quality: 85 }).toFile(path.join(FULL_DIR, fullName))
  return { thumb: `thumbs/${thumbName}`, full: `full/${fullName}` }
}

// 永久旋转：按累计角度从源图旋转，重新生成缩略图与大图（浏览器显示用）
export async function rotatePhoto(filename, totalDegrees, sourcePath = path.join(UPLOAD_DIR, filename)) {
  const img = await loadImage(sourcePath)
  const base = path.basename(filename)
  const thumbName = `thumb-${base}`
  const fullName = `full-${base}`
  await img.clone().rotate(totalDegrees).resize({ width: 600, withoutEnlargement: true }).jpeg({ quality: 80 }).toFile(path.join(THUMB_DIR, thumbName))
  await img.rotate(totalDegrees).resize({ width: 1600, withoutEnlargement: true }).jpeg({ quality: 85 }).toFile(path.join(FULL_DIR, fullName))
  return { thumb: `thumbs/${thumbName}`, full: `full/${fullName}` }
}

// ---- 视频处理 ----

const VIDEO_EXTS = new Set(['.mov', '.mp4', '.m4v'])
export const isVideoFile = (name) => VIDEO_EXTS.has(path.extname(name).toLowerCase())

// 选择 ffmpeg：优先支持 NVENC 的（GPU 加速），否则退回静态版
// 候选顺序：FFMPEG_PATH env → 包目录(exe 同目录，打包态) → ~/bin/ffmpeg → 系统 PATH → ffmpeg-static
let ffmpegCache = null
async function resolveFfmpeg() {
  if (ffmpegCache) return ffmpegCache
  const exeSuffix = process.platform === 'win32' ? '.exe' : ''
  const home = path.join(process.env.HOME || '', 'bin', `ffmpeg${exeSuffix}`)
  const candidates = [
    process.env.FFMPEG_PATH,
    path.join(BASE_DIR, `ffmpeg${exeSuffix}`),
    home,
    'ffmpeg',
    ffmpegPath,
  ].filter(Boolean)
  for (const candidate of candidates) {
    try {
      const { stdout } = await execFileAsync(candidate, ['-hide_banner', '-encoders'])
      const gpu = /h264_nvenc/.test(stdout)
      console.log(`[ffmpeg] 使用: ${candidate}${gpu ? ' (NVENC)' : ''}`)
      ffmpegCache = { path: candidate, gpu }
      return ffmpegCache
    } catch { /* 下一个候选 */ }
  }
  ffmpegCache = { path: ffmpegPath, gpu: false }
  return ffmpegCache
}

// 选择 ffprobe：包目录优先于静态版（打包态静态版在只读快照内无法执行）
let ffprobeCache = null
async function resolveFfprobe() {
  if (ffprobeCache) return ffprobeCache
  const exeSuffix = process.platform === 'win32' ? '.exe' : ''
  const candidates = [
    process.env.FFPROBE_PATH,
    path.join(BASE_DIR, `ffprobe${exeSuffix}`),
    ffprobePath.path,
  ].filter(Boolean)
  for (const c of candidates) {
    try {
      await execFileAsync(c, ['-version'])
      ffprobeCache = c
      return ffprobeCache
    } catch { /* 下一个候选 */ }
  }
  ffprobeCache = ffprobePath.path
  return ffprobeCache
}

// 解析 ISO6709 位置标签，如 "+23.0106+113.1620/" 或 "+23.0106+113.1620+10.5/"
function parseIso6709(loc) {
  if (!loc) return null
  const m = String(loc).match(/^([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)/)
  if (!m) return null
  return { lat: Number(m[1]), lng: Number(m[2]) }
}

// ffprobe 读取视频元数据：GPS、拍摄时间、时长
export async function probeVideo(srcPath) {
  const { stdout } = await execFileAsync(await resolveFfprobe(), [
    '-v', 'quiet', '-print_format', 'json', '-show_format', srcPath,
  ])
  const j = JSON.parse(stdout)
  const tags = j.format?.tags || {}
  const locRaw = tags.location || tags['location-eng'] || tags['com.apple.quicktime.location.ISO6709']
  const pos = parseIso6709(locRaw)
  let takenAt = tags.creation_time ?? null
  if (takenAt && !isNaN(new Date(takenAt))) takenAt = new Date(takenAt).toISOString()
  else takenAt = null
  const duration = Number(j.format?.duration) || null
  return { lat: pos?.lat ?? null, lng: pos?.lng ?? null, takenAt, duration }
}

// 抽海报帧：优先第 1 秒，取不到帧（如视频不足 1 秒）时回退首帧。
// 注意：部分 ffmpeg 版本 seek 越界时退出码为 0 但不写文件，因此以产物存在且非空判定成功
async function extractPoster(ffPath, videoPath, width, dest) {
  const attempts = [
    ['-y', '-ss', '1', '-i', videoPath, '-frames:v', '1', '-vf', `scale=${width}:-2`, dest],
    ['-y', '-i', videoPath, '-frames:v', '1', '-vf', `scale=${width}:-2`, dest],
  ]
  for (const args of attempts) {
    try { await execFileAsync(ffPath, args) } catch { /* 尝试下一种方式 */ }
    try {
      if (fs.statSync(dest).size > 0) return
    } catch { /* 文件未生成，重试 */ }
  }
  throw new Error(`海报帧抽取失败: ${dest}`)
}

// 视频入库资产：转码 H.264 MP4（浏览器可播）+ 抽帧海报（缩略图/大图）
// 默认降为宽 1280（省空间）；opts.keepOriginalResolution 保持原分辨率
// 有 NVIDIA GPU 时用 NVENC 硬件加速，否则 CPU libx264
// 返回 { video: 'xxx.mp4'(uploads 相对), thumb, full, duration }
export async function makeVideoAssets(baseName, sourcePath, { keepOriginalResolution = false } = {}) {
  const stem = path.basename(baseName, path.extname(baseName))
  let videoName = `${stem}.mp4`
  let destVideo = path.join(UPLOAD_DIR, videoName)
  // 上传的源文件本身就是 .mp4 时，multer 临时文件与产物同名，ffmpeg 禁止原地编辑 → 自动换名
  if (path.resolve(destVideo) === path.resolve(sourcePath)) {
    videoName = `${stem}_v.mp4`
    destVideo = path.join(UPLOAD_DIR, videoName)
  }
  const ff = await resolveFfmpeg()
  const scaleArgs = keepOriginalResolution ? [] : ['-vf', "scale='min(1280,iw)':-2"]
  // 转码：H.264 + AAC，faststart 便于边下边播
  const args = ['-y']
  if (ff.gpu) args.push('-hwaccel', 'cuda')
  args.push('-i', sourcePath,
    ...scaleArgs,
    '-c:v', ff.gpu ? 'h264_nvenc' : 'libx264',
    '-preset', ff.gpu ? 'p4' : 'medium', '-crf', '23',
    '-c:a', 'aac', '-b:a', '128k',
    '-movflags', '+faststart')
  try {
    await execFileAsync(ff.path, [...args, destVideo])
  } catch (e) {
    // GPU 编码失败时回退 CPU，并保留失败原因便于诊断
    if (ff.gpu) {
      const reason = String(e.stderr || '').split('\n').filter((l) => /Error|error|failed/i.test(l)).slice(-2).join(' | ') || e.message
      console.warn(`[ffmpeg] NVENC 转码失败，回退 CPU：${reason}`)
      await execFileAsync(ffmpegPath, [
        '-y', '-i', sourcePath,
        ...scaleArgs,
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '23',
        '-c:a', 'aac', '-b:a', '128k',
        '-movflags', '+faststart',
        destVideo,
      ])
    } else throw e
  }
  // 海报帧：从转码产物第 1 秒抽帧（视频不足 1 秒时回退首帧）
  const base = path.basename(videoName)
  const thumbName = `thumb-${base}.jpg`
  const fullName = `full-${base}.jpg`
  await extractPoster(ff.path, destVideo, 600, path.join(THUMB_DIR, thumbName))
  await extractPoster(ff.path, destVideo, 1600, path.join(FULL_DIR, fullName))
  const { duration } = await probeVideo(destVideo)
  return { video: videoName, thumb: `thumbs/${thumbName}`, full: `full/${fullName}`, duration }
}
