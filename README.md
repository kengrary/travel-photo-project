# 旅行照片地图 (Travel Photo Map)

把旅行照片按拍摄地点展示在地图上的小工具。上传照片后自动读取 GPS 信息，逆地理编码出省/市/县，未定位的照片可在地图上手动点击补位。

- **全本地存储**：照片与数据库都在你自己的机器上，不经过任何第三方服务
- **离线逆地理编码**：GPS → 省/市/县使用内置的行政区划边界数据，无需申请任何 API key
- 支持照片（JPG/PNG/HEIC/WebP 等）与视频（MOV/MP4，自动转码 720p）

## 首次运行

```bash
npm install
npm run bootstrap:geo   # 下载中国边界数据（必须，git-ignored，每个克隆都要重新执行）
npm run dev             # 或 npm run build && npm start
```

要求 Node.js >= 18。依赖中有原生模块（better-sqlite3、sharp），Linux/macOS 一般直接安装预编译二进制；Windows 若编译失败需安装 Visual Studio Build Tools 与 Python。

> `bootstrap:geo` 从阿里 DataV GeoAtlas 下载省市县边界 GeoJSON 到 `server/data/geojson/`。部分 adcode 没有 `_full` 文件会 404，属预期行为，脚本会自动跳过。

## Docker 部署

```bash
docker compose up -d          # 首次启动自动下载边界数据
# 访问 http://localhost:3000
```

数据持久化：`./server/data`（SQLite + 边界数据）与 `./uploads`（照片文件）挂载到宿主机。

## 桌面便携包（免安装）

不想装 Node.js？到 [Releases](https://github.com/kengrary/travel-photo-project/releases) 下载对应平台的便携包（如 `travel-photo-map-win-x64.zip`）：

1. 解压到任意目录，双击 `启动.bat`（Windows）/ `start.sh`（Linux）
2. 服务启动后自动打开浏览器；端口被占用时自动 +1 重试
3. 首次启动自动下载中国边界数据（约 1 分钟），之后完全离线可用

- 照片与数据库保存在包目录下的 `uploads/` 与 `data/`
- 包内自带 ffmpeg/ffprobe，视频转码开箱即用
- 也可自行构建：在目标平台上 `npm install && npm run build:exe`

## 页面

- **地图** (`/`): 按省/市/县聚簇展示照片拍摄地。
- **上传** (`/upload`): 上传照片，自动定位；无 GPS 或解析失败的照片进入手动定位流程。
- **照片墙** (`/wall`): 按地点分组浏览，支持搜索、时间段筛选、拖拽改归属、批量管理。
- **时间轴** (`/timeline`): 按年月回顾去过的地方。
- **批量导入** (`/import`): 服务器目录扫描 → 统计 → 勾选 → 后台导入（见下文）。

视频上传/导入默认转码为 720p H.264 以节省空间并保证浏览器可播；需要画质时可勾选「视频保持原分辨率」（仍会统一转码）。

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | 服务端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `DB_PATH` | `server/data/app.db` | SQLite 数据库路径 |
| `ACCESS_TOKEN` | 未设置 | 设置后上传/删除/修改等写操作需要令牌（请求头 `x-access-token`；浏览器首次遇到 401 会弹窗输入）。公网部署建议开启 |
| `FFMPEG_PATH` | 自动探测 | 视频转码用的 ffmpeg 路径；默认依次探测 `~/bin/ffmpeg`、系统 `ffmpeg`、内置 ffmpeg-static |

## 可选：访问令牌

部署到公网时建议设置环境变量 `ACCESS_TOKEN`：

```bash
ACCESS_TOKEN=你的令牌 npm start
```

不设置则所有操作无需鉴权（个人本地使用无需配置）。

## 脚本

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 开发模式（前后端热更新） |
| `npm run build` | 构建前端到 `dist/` |
| `npm start` | 启动生产服务 |
| `npm test` | 运行服务端测试 |
| `npm run bootstrap:geo` | 下载中国边界数据到 `server/data/geojson/` |
| `npm run backup` | 备份数据库 + 照片文件到 `backups/` |

## 网页批量导入

照片在 NAS / 移动硬盘 / 服务器磁盘上时，用 `/import` 页面免上传批量入库：

1. 输入照片所在的服务器绝对路径（需服务进程可读），开始扫描
2. 扫描完成后先看统计：按"省·市"聚合的数量与体积、月份/格式分布、无 GPS 与已导入重复数
3. 点击省市卡片整组勾选，或按月/格式筛选后在列表勾选
4. 可选「不复制原图」（仅生成缩略图+大图，省空间）、「视频保持原分辨率」，开始后台导入并查看进度

- 按 `origin_path` 幂等：重复扫描会标记已导入项，默认隐藏，不会重复入库
- 任务进度保存在内存中，服务重启后需重新扫描
- 命令行版功能相同（参数更全）：见下方「批量导入本地照片」

## 批量导入本地照片

把本地整个照片目录一次性导入（自动读 GPS 定位、生成缩略图/大图、写数据库）：

```bash
node server/scripts/import-photos.js /path/to/照片目录
# 先试跑不写库：
node server/scripts/import-photos.js /path/to/照片目录 --dry-run
```

**过滤干扰图片**（按省市县/是否有位置筛选）：

```bash
# 只导入非广东省的照片（排除干扰）
node server/scripts/import-photos.js /path/to/照片目录 --exclude-province 广东省

# 只导入指定省的照片（可多次指定）
node server/scripts/import-photos.js /path/to/照片目录 --include-province 浙江省 --include-province 江苏省

# 只导入无位置的照片
node server/scripts/import-photos.js /path/to/照片目录 --no-location

# 只导入指定格式（可逗号分隔多个）
node server/scripts/import-photos.js /path/to/照片目录 --ext heic
node server/scripts/import-photos.js /path/to/照片目录 --ext heic,jpg
```

- 递归扫描目录下的 jpg/jpeg/png/heic/heif/webp/gif/bmp/tif 等图片，以及 mov/mp4/m4v 视频
- 视频自动转码 720p MP4 + 海报帧（与网页上传一致），GPS 取自拍摄元数据
- 有 GPS 的照片自动反查省市县；无 GPS 的归入"未知位置"（可在地图/照片墙手动补）
- 已导入过的文件（按来源路径）会自动跳过，可安全重复运行

## 隐私

照片及其缩略图保存在本地（SQLite `server/data/app.db` 和 `uploads/`），不上传任何外部服务。唯一的网络请求是浏览器加载高德底图瓦片。

## 致谢

- [MapLibre GL](https://maplibre.org/) — 开源地图渲染
- [阿里 DataV GeoAtlas](https://datav.aliyun.com/portal/school/atlas/area_selector) — 中国行政区划边界数据
- 高德地图 — 底图瓦片（© 高德地图）
- [exifr](https://github.com/MikeKovarik/exifr)、[sharp](https://sharp.pixelplumbing.com/)、[heic-decode](https://github.com/catdad-experiments/heic-decode) — 照片元数据与图像处理

## License

[MIT](LICENSE)
