# AGENTS.md

个人自托管旅行照片地图：React+Vite+MapLibre 前端 + Express 后端 + better-sqlite3。全中文注释/提交信息，提交用 `feat:`/`fix:`/`style:` 中文描述。

## 命令

```bash
npm install
npm run bootstrap:geo   # 必须先跑：下载边界数据到 server/data/geojson/（git-ignored，每个克隆都要重跑）
npm run dev             # concurrently 起两个进程：node --watch server/index.js (:3000) + vite (:5173)
npm run build && npm start  # 生产：单端口 3000，Express 托管 dist/ + /api + /uploads + /data + SPA fallback
npm test                # node --test server/*.test.js（无 lint/typecheck 配置）
```

- 单测一个文件：`node --test server/db.test.js`
- **测试也依赖边界数据**：`routes.test.js` 会调 `loadGeoIndex()` 读 `server/data/geojson/100000_full.json`，没跑过 `bootstrap:geo` 会挂。
- 服务端启动时校验边界数据，缺失直接 `process.exit(1)`（见 server/index.js:16）。
- ESM 项目（`"type": "module"`），所有代码含脚本都用 import/export。

## 架构要点

- **离线逆地理编码**：GPS→省/市/县靠 point-in-polygon 遍历阿里 DataV GeoAtlas 边界文件（server/geocode.js），无外部 API。直辖市特殊处理（city=直辖市名）。bootstrap 下载时部分 adcode 无 `_full` 文件会 404，属预期，跳过即可。
- **DB**：better-sqlite3 同步 API，WAL 模式，路径 `server/data/app.db`（可用 `DB_PATH` 覆盖）。**迁移写在 openDb() 里**（PRAGMA table_info 逐列 ALTER TABLE，见 server/db.js:32）——加列必须同步加在这里，没有独立迁移文件。
- **HEIC 解码**：sharp 预编译版不含 HEVC 解码器，HEIC/HEIF 必须先经 heic-decode 转原始像素再进 sharp（统一走 server/upload.js 的 `loadImage()`）。
- **uploads/ 布局**：原图 `uploads/<filename>`，缩略图 `thumbs/thumb-<filename>`，大图 `full/full-<filename>`；缩略图/大图一律转 JPEG。multer 上限 30MB。
- **路径解析统一走 server/paths.js**：DB/UPLOAD/GEO/DIST/BACKUPS 目录都从这里取（env `DB_PATH`/`UPLOAD_DIR`/`GEO_DIR` 优先），不要在业务代码里手写相对路径；`IS_PACKAGED` 预留给 exe 打包态。
- 照片定位三字段 province/city/county 是聚合与筛选的键；无 GPS 照片归"未知位置"，可在地图手动补点。
- 页面路由：`/`(地图)、`/wall`(照片墙)、`/timeline`(时间轴)、`/upload`(上传)、`/import`(批量导入)。API 在 `/api/photos*`、`/api/import*` 与 `/api/geocode/reverse`。
- **视频转码**：默认降为宽 1280；`makeVideoAssets(..., { keepOriginalResolution: true })` 保持原分辨率（上传走 multipart 字段 `videoScale=original`）。海报帧抽取以产物存在且非空判定成功（部分 ffmpeg seek 越界退出码为 0 但不写文件）。

## 批量导入

网页版：`/import` 页面（服务器路径扫描 → 统计 → 勾选 → 后台导入），与 CLI 共用 `server/import-core.js`（collectMediaFiles / prepareItem / commitItem）。API 在 `server/routes/import.js`，任务存内存。

```bash
node server/scripts/import-photos.js <目录> [--dry-run] [--exclude-province 广东省] [--include-province 浙江省] [--no-location] [--ext heic,jpg] [--no-original]
```

按 origin_path 幂等，可安全重复运行。设计文档在 docs/superpowers/{specs,plans}/。
