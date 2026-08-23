import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import ffmpegPath from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'
import { makeVideoAssets, probeVideo, uploadDir } from './upload.js'

const execFileAsync = promisify(execFile)

// 读视频宽度（验证分辨率选项）
async function videoWidth(filePath) {
  const { stdout } = await execFileAsync(ffprobeStatic.path, [
    '-v', 'quiet', '-print_format', 'json', '-show_streams', '-select_streams', 'v:0', filePath,
  ])
  return JSON.parse(stdout).streams[0].width
}
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-test-'))
const created = [] // 记录 makeVideoAssets 产物，测试后清理

function assetPaths(videoName) {
  const base = path.basename(videoName)
  return [
    path.join(uploadDir, videoName),
    path.join(uploadDir, 'thumbs', `thumb-${base}.jpg`),
    path.join(uploadDir, 'full', `full-${base}.jpg`),
  ]
}

async function genClip(dest, duration) {
  await execFileAsync(ffmpegPath, [
    '-y', '-f', 'lavfi', '-i', `testsrc=duration=${duration}:size=320x240:rate=10`,
    '-pix_fmt', 'yuv420p', dest,
  ])
}

before(async () => {
  await genClip(path.join(tmpDir, 'short.mp4'), 0.4)
  await genClip(path.join(tmpDir, 'normal.mp4'), 3)
  // 大尺寸片段：验证默认降分辨率与保持原分辨率
  await execFileAsync(ffmpegPath, ['-y', '-f', 'lavfi', '-i', 'testsrc=duration=0.5:size=1920x1080:rate=10', '-pix_fmt', 'yuv420p', path.join(tmpDir, 'big.mp4')])
})

after(() => {
  for (const p of created) { try { fs.unlinkSync(p) } catch {} }
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

test('makeVideoAssets 为正常时长视频生成海报帧', async () => {
  const r = await makeVideoAssets(`t-normal-${Date.now()}.mp4`, path.join(tmpDir, 'normal.mp4'))
  created.push(...assetPaths(r.video))
  assert.ok(fs.existsSync(path.join(uploadDir, r.thumb)), '缩略图应存在')
  assert.ok(fs.existsSync(path.join(uploadDir, r.full)), '大图应存在')
})

test('makeVideoAssets 对不足 1 秒的视频仍能生成有效海报帧', async () => {
  const r = await makeVideoAssets(`t-short-${Date.now()}.mp4`, path.join(tmpDir, 'short.mp4'))
  created.push(...assetPaths(r.video))
  for (const p of [r.thumb, r.full]) {
    const full = path.join(uploadDir, p)
    assert.ok(fs.existsSync(full), `${p} 应存在`)
    assert.ok(fs.statSync(full).size > 1000, `${p} 应是有效的 JPEG（>1KB）`)
  }
})

test('makeVideoAssets 默认将大视频降为 1280 宽', async () => {
  const r = await makeVideoAssets(`t-big-${Date.now()}.mp4`, path.join(tmpDir, 'big.mp4'))
  created.push(...assetPaths(r.video))
  assert.equal(await videoWidth(path.join(uploadDir, r.video)), 1280)
})

test('makeVideoAssets keepOriginalResolution 保持原分辨率', async () => {
  const r = await makeVideoAssets(`t-bigorig-${Date.now()}.mp4`, path.join(tmpDir, 'big.mp4'), { keepOriginalResolution: true })
  created.push(...assetPaths(r.video))
  assert.equal(await videoWidth(path.join(uploadDir, r.video)), 1920)
})

test('makeVideoAssets 输入即 .mp4（源文件已在 uploads 内）时不允许原地覆盖，自动换名', async () => {
  // 模拟上传路由：multer 已把 .mp4 存进 uploads/<name>.mp4，再以其为源转码
  const name = `t-inplace-${Date.now()}.mp4`
  const srcInUploads = path.join(uploadDir, name)
  fs.copyFileSync(path.join(tmpDir, 'short.mp4'), srcInUploads)
  created.push(srcInUploads)
  const r = await makeVideoAssets(name, srcInUploads)
  created.push(...assetPaths(r.video))
  assert.notEqual(r.video, name, '产物名必须与源名不同')
  assert.ok(fs.existsSync(path.join(uploadDir, r.video)), '转码产物应存在')
  assert.ok(fs.statSync(path.join(uploadDir, r.thumb)).size > 1000, '海报帧应有效')
})
