# 旅行照片地图应用 — 设计文档

日期：2026-08-20
状态：已批准（用户确认后进入实现）

## 1. 产品定位

个人自用的旅行照片管理 Web 应用。在中国地图上（精确到市县）记录去过的地点、上传对应照片，并用照片墙展示。

- 平台：Web 网页应用
- 使用方式：个人自用（无账号体系、无多用户）
- 运行形态：本地 / 自托管，无需打包成安装程序

## 2. 技术栈

- **前端**：React 18 + Vite + MapLibre GL + React Router
- **后端**：Node + Express + multer（上传）+ better-sqlite3 + exifr（读 EXIF GPS）+ sharp（生成缩略图）
- **存储**：SQLite（照片元数据）+ 本地 `uploads/` 目录（原图 + 缩略图）
- **地图数据**：阿里 DataV GeoAtlas 中国市县边界 GeoJSON（自托管，免费，离线）
- **底图瓦片**：免费公开的中国地图瓦片（不申请 key），若受防盗链限制再切换

## 3. 总体架构

单机自托管。`npm run dev` 启动一个 Express 服务，同时托管前端静态资源和后端 API。浏览器访问即可。

```
前端 (React + Vite)
  ├── 地图页（MapLibre GL + 市县边界 GeoJSON）
  ├── 上传组件
  └── 照片墙视图（地图的次级视图）
        │  HTTP API (REST/JSON)
后端 (Node + Express)
  ├── 照片上传/存储 API
  ├── 照片元数据 API
  ├── 本地边界匹配（GPS → 市县）
  └── 静态托管前端 + 照片文件
存储
  ├── SQLite（photos 表）
  ├── uploads/（原图 + 缩略图）
  └── 市县边界 GeoJSON 数据文件
```

## 4. 数据模型（SQLite）

**photos 表**

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK AUTOINCREMENT | 主键 |
| filename | TEXT | 存储文件名（唯一） |
| original_name | TEXT | 原始文件名 |
| thumb_path | TEXT | 缩略图相对路径 |
| taken_at | TEXT | 拍摄时间（EXIF，可为空） |
| lat | REAL | 纬度（可为空） |
| lng | REAL | 经度（可为空） |
| province | TEXT | 省 |
| city | TEXT | 市 |
| county | TEXT | 区县 |
| location_name | TEXT | 手动指定的地点名（可为空） |
| created_at | TEXT | 上传时间 |

按 `province / city / county` 字段 GROUP BY 实现地点分组，无需单独的 locations 表。

## 5. 地图页（主界面）

- MapLibre GL 加载中国地图，叠加市县边界 GeoJSON 图层
- 市县区域用颜色深浅表示照片数量（无照片的浅灰）
- 点击市县区域 → 打开该地的照片墙视图（次级视图）
- 已有照片的位置显示 marker，点击 marker 查看该照片
- 提供「上传照片」入口

## 6. 上传流程

- 多选照片上传，后端逐张读取 EXIF GPS：
  - 有 GPS → 用**本地边界匹配**反查省市县（离线、无 key）
  - 无 GPS → 进入手动确认界面：在地图上点选位置或搜索市县名，指定给照片
- 上传后生成缩略图，写入元数据

## 7. 照片墙视图（地图的次级视图）

- 以地图为主，照片墙是点开某市县或切换入口后的视图
- 网格/瀑布流展示
- 排序切换：
  - 按时间（从新到旧）
  - 按地点（省 → 市 → 县分组）
- 点击照片放大查看（lightbox），显示拍摄时间、地点、地址
- 支持按省 / 市 / 时间段筛选

## 8. 后端 API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/photos | 上传照片（multipart） |
| GET | /api/photos | 查询照片（按时间/地点/省/市筛选） |
| GET | /api/locations | 各市县照片数量（供地图着色） |
| POST | /api/photos/:id/location | 手动指定/修改地点 |
| GET | /uploads/... | 提供照片文件 |

## 9. 边界数据

- 使用阿里 DataV GeoAtlas 提供的中国省市县边界 GeoJSON，自托管到项目内
- 免费、离线可用，无需 API key

## 10. 待定/风险

- 免费底图瓦片可能受防盗链/域名限制：若不可用，改用矢量底图（MapLibre 默认样式）叠加市县边界，或切换瓦片源。
- 中国市县边界 GeoJSON 文件体积较大（约几十 MB），首次加载需优化（可分层：省份层 + 点击后加载市县层）。
