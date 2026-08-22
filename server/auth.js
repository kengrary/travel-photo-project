// 写操作鉴权：设置环境变量 ACCESS_TOKEN 后启用
// 非 GET/HEAD/OPTIONS 请求必须携带请求头 x-access-token，值与 ACCESS_TOKEN 一致
export function writeAuthGuard(req, res, next) {
  const token = process.env.ACCESS_TOKEN
  if (!token) return next() // 未配置则不启用鉴权
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next()
  if (req.headers['x-access-token'] === token) return next()
  return res.status(401).json({ error: 'Unauthorized' })
}
