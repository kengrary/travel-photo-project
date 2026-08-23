// 构建便携文件夹包（免编译，秒级）：node scripts/build-exe.js [--target win-x64|linux-x64|mac-arm64]
// 必须在目标平台上执行（Node 运行时与原生模块需匹配平台）；CI 按平台矩阵分别构建。
// 产物 release/travel-photo-map-<target>.zip：
//   启动.bat / start.sh        启动脚本（设 PORTABLE_APP=1，服务起来后自动开浏览器）
//   runtime/node(.exe)         内嵌 Node 运行时
//   server/ + node_modules/    后端与生产依赖
//   dist/                      前端静态文件
//   ffmpeg(.exe) ffprobe(.exe) 视频转码二进制
//   data/ uploads/             首次运行生成（边界数据自动下载）
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const args = process.argv.slice(2)
const targetArg = args.includes('--target') ? args[args.indexOf('--target') + 1] : null
const plat = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux'
const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
const TARGET = targetArg || `${plat}-${arch}`

const EXE_SUFFIX = TARGET.startsWith('win') ? '.exe' : ''
// ffprobe-static 的目录命名：win32/linux/darwin + 架构
const FFPROBE_PLAT = TARGET.startsWith('win') ? 'win32' : TARGET.startsWith('mac') ? 'darwin' : 'linux'

function run(cmd, cmdArgs, opts = {}) {
  console.log('+', cmd, ...cmdArgs)
  execFileSync(cmd, cmdArgs, { stdio: 'inherit', cwd: root, shell: process.platform === 'win32', ...opts })
}

function mustExist(label, p) {
  if (!p || !fs.existsSync(p)) {
    console.error(`找不到 ${label}: ${p}\n请在目标平台上先 npm install`)
    process.exit(1)
  }
  return p
}

console.log(`== 组装便携包 target=${TARGET} ==`)

// 1) 前端构建
run('npm', ['run', 'build'])

// 2) 转码二进制（本机 node_modules 内即为目标平台版本）
const ffmpegBin = mustExist('ffmpeg-static', path.join(root, 'node_modules', 'ffmpeg-static', `ffmpeg${EXE_SUFFIX}`))
const ffprobeBin = mustExist(
  'ffprobe-static',
  path.join(root, 'node_modules', 'ffprobe-static', 'bin', FFPROBE_PLAT, arch, `ffprobe${EXE_SUFFIX}`),
)

// 3) 组装目录
const outDir = path.join(root, 'release', `travel-photo-map-${TARGET}`)
fs.rmSync(outDir, { recursive: true, force: true })
fs.mkdirSync(outDir, { recursive: true })

// 生产 node_modules：复制现有依赖树并剔除仅开发用的顶层包（离线、免联网安装）
// （不用 npm ci --omit=dev：需要联网且会重新下载 ffmpeg 等大二进制，慢且易卡）
fs.cpSync(path.join(root, 'node_modules'), path.join(outDir, 'node_modules'), { recursive: true })
const pkgJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const devOnly = new Set(Object.keys(pkgJson.devDependencies || {}))
devOnly.add('esbuild'); devOnly.add('@esbuild'); devOnly.add('rollup'); devOnly.add('postcss') // vite 的传递依赖，运行时无用
for (const name of devOnly) {
  fs.rmSync(path.join(outDir, 'node_modules', name), { recursive: true, force: true })
}

fs.cpSync(path.join(root, 'server'), path.join(outDir, 'server'), { recursive: true })
fs.cpSync(path.join(root, 'dist'), path.join(outDir, 'dist'), { recursive: true })
fs.copyFileSync(ffmpegBin, path.join(outDir, `ffmpeg${EXE_SUFFIX}`))
fs.copyFileSync(ffprobeBin, path.join(outDir, `ffprobe${EXE_SUFFIX}`))

// 内嵌 Node 运行时（复制当前正在运行的 node 二进制）
const runtimeDir = path.join(outDir, 'runtime')
fs.mkdirSync(runtimeDir, { recursive: true })
fs.copyFileSync(process.execPath, path.join(runtimeDir, `node${EXE_SUFFIX}`))
if (process.platform !== 'win32') fs.chmodSync(path.join(runtimeDir, `node${EXE_SUFFIX}`), 0o755)

// 4) 启动脚本
if (TARGET.startsWith('win')) {
  fs.writeFileSync(
    path.join(outDir, '启动.bat'),
    ['@echo off', 'cd /d %~dp0', 'set PORTABLE_APP=1', '"runtime\\node.exe" "server\\index.js"', 'pause'].join('\r\n'),
  )
} else {
  const sh = ['#!/bin/sh', 'cd "$(dirname "$0")"', 'PORTABLE_APP=1 exec ./runtime/node server/index.js'].join('\n')
  const p = path.join(outDir, TARGET.startsWith('mac') ? '启动.command' : 'start.sh')
  fs.writeFileSync(p, sh)
  fs.chmodSync(p, 0o755)
}

// 5) 压缩
const zipDest = path.join(root, 'release', `travel-photo-map-${TARGET}.zip`)
fs.rmSync(zipDest, { force: true })
if (process.platform === 'win32') {
  run('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${outDir}\\*' -DestinationPath '${zipDest}'`])
} else {
  run('zip', ['-r', '-q', zipDest, '.'], { cwd: outDir })
}
console.log(`\n✓ 完成: ${path.relative(root, zipDest)} (${(fs.statSync(zipDest).size / 2 ** 20).toFixed(0)} MB)`)
