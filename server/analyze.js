// 启发式择优：完全不依赖模型/联网，用 sharp 读取像素做基础质量打分。
// 该模块是"分析 provider 接口"的默认实现；将来接云端/本地 VLM 时替换 analyzeAssets 即可，
// 上层 video-render 只消费 { id, filename, score, phash, ... } 这些字段。
import sharp from 'sharp'

// 单通道灰度：已是单通道直接返回；多通道按 ITU-R BT.601 亮度加权
export function toGray(data, width, height, channels) {
  if (channels === 1) return Uint8Array.from(data)
  const out = new Uint8Array(width * height)
  for (let i = 0; i < out.length; i++) {
    const o = i * channels
    out[i] = Math.round(0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2])
  }
  return out
}

// 差异哈希：9x8 灰度相邻列比较，得 64 位（16 位十六进制）
export function dHash(gray, width, height) {
  let bits = 0n
  let n = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width - 1; x++) {
      if (gray[y * width + x] > gray[y * width + x + 1]) bits |= 1n << BigInt(n)
      n++
    }
  }
  return bits.toString(16).padStart(16, '0')
}

// 汉明距离：两个十六进制哈希的按位差异数
export function hammingDistance(a, b) {
  let x = BigInt('0x' + a) ^ BigInt('0x' + b)
  let c = 0
  while (x > 0n) { c += Number(x & 1n); x >>= 1n }
  return c
}

// 拉普拉斯方差：清晰度指标（越大越锐利）
export function laplacianVariance(gray, width, height) {
  const vals = []
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x
      const lap = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - width] - gray[i + width]
      vals.push(lap)
    }
  }
  if (vals.length === 0) return 0
  const mean = vals.reduce((s, v) => s + v, 0) / vals.length
  return vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length
}

// 曝光异常比例：亮度 <=5 或 >=250 的像素占比
export function exposureRatio(gray) {
  let bad = 0
  for (const g of gray) if (g <= 5 || g >= 250) bad++
  return gray.length ? bad / gray.length : 0
}

// 把三项指标折成 0..1 综合分
export function scoreMetrics({ sharpness, exposure, width, height }) {
  const sharpScore = Math.min(1, sharpness / 400)          // 经验阈值，400 以上视为足够锐
  const exposureScore = 1 - Math.min(1, exposure / 0.15)   // 异常像素 15% 以上视为过曝/欠曝严重
  const resScore = Math.min(1, (width * height) / (1920 * 1080))
  return Math.round((sharpScore * 0.5 + exposureScore * 0.3 + resScore * 0.2) * 1000) / 1000
}

// 读取一批素材图片，产出每张的指标与评分；单张失败跳过
export async function analyzeAssets(items) {
  const out = []
  for (const it of items) {
    try {
      const img = sharp(it.imagePath)
      const meta = await img.metadata()
      const small = await sharp(it.imagePath).resize(9, 8, { fit: 'fill' }).grayscale().raw().toBuffer()
      const full = await sharp(it.imagePath).resize(320, null, { withoutEnlargement: true }).grayscale().raw().toBuffer({ resolveWithObject: true })
      const sharpness = laplacianVariance(full.data, full.info.width, full.info.height)
      const gray = toGray(full.data, full.info.width, full.info.height, full.info.channels)
      const exposure = exposureRatio(gray)
      const width = meta.width || full.info.width
      const height = meta.height || full.info.height
      out.push({
        id: it.id, filename: it.filename,
        width, height, sharpness, exposure,
        phash: dHash(small, 9, 8),
        score: scoreMetrics({ sharpness, exposure, width, height }),
      })
    } catch {
      // 单张分析失败：给中位分兜底，不阻断整体
      out.push({ id: it.id, filename: it.filename, width: 0, height: 0, sharpness: 0, exposure: 0, phash: '0000000000000000', score: 0.5 })
    }
  }
  return out
}
