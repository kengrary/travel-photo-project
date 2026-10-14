# 旅行照片成片（A+C 本地成片）设计

日期：2026-10-14
状态：已确认

## 背景与目标

在地图按地点一键把该处的照片与视频合成为一段旅行视频（"成片"），全程本地、离线，复用现有 ffmpeg（NVENC）能力。

**非目标**：接 AI（云端/本地模型）、自动发布到抖音/B站等平台、云端存储。这些留作后续独立子项目。

## 需求决策

- **选段**：地图地点聚类入口。点某省/市/县 → 拉该地点全部照片+视频。
- **筛选**：生成前有素材筛选步骤，默认全选，可取消勾选/全选/反选；全不选时禁用生成。顺序按 `takenAt` 升序（不做手动重排）。
- **画幅**：16:9 与 9:16 都要（生成时选）。
- **构成**：照片 Ken Burns 运镜 + 交叉转场；视频片段剪短穿插并保留原声；字幕。
- **BGM**：本地音乐目录 `DATA_DIR/music` 选曲；目录为空则无 BGM。
- **产物**：后台任务生成到 `exports/` 目录，**不写入照片库**；完成后可预览/下载；有"我的成片"列表页。
- **字幕**：ASS 烧录；片头大标题（地点名 + 日期范围 + 张数），无逐张日期字幕。字体用系统字体。
- **AI**：本轮不接；`analyze` 抽成 provider 接口占位；默认 provider 提供**非 AI 择优/剔废**（sharp 指标）。

## 用户流程

```
地图点地点聚类
  → "生成旅行视频"
  → 素材筛选面板（缩略图网格，默认全选，可勾掉/全选/反选）
  → 参数：画幅(16:9 / 9:16)、BGM 选曲、时长档(短/中/长)
  → POST /api/videos/render → jobId
  → 进度条（轮询 job）
  → 完成后当场 <video> 预览 + 下载
历史成片在 /videos「我的成片」页：列出（播放/下载/删除）
```

## 架构与数据流

```
MapPage（地点面板）
  └─ 筛选+参数对话框（复用 PhotoGrid 拉取该地点素材）
       └─ POST /api/videos/render { fileNames[], placeName, aspect, bgm, length }
            └─ routes/videos.js  内存 job（全局单任务）
                 └─ video-render.js  两阶段 ffmpeg
                      ├─ analyze.js（heuristic provider：择优/剔废/采样）
                      ├─ 阶段一：逐素材 → 统一规格中间片段（临时目录）
                      └─ 阶段二：xfade 拼接 + ass 字幕 + amix 混音
                           └─ exports/<地点>-<时间戳>.mp4
```

## 后端模块

### `server/routes/videos.js`

复用 `routes/import.js` 的内存 job 模式（单进程自托管；重启失效），全局同一时间只允许一个渲染任务。

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/videos/render` | 启动渲染。body：`{ fileNames: string[], placeName: string, aspect: '16:9'\|'9:16', bgm: string\|null, length: 'short'\|'medium'\|'long' }`。返回 `{ jobId }` |
| GET | `/api/videos/jobs/:id` | 轮询进度：`{ id, status, phase, processed, total, error, output? }` |
| GET | `/api/videos` | 列出已生成成片（名称、大小、mtime、时长可选） |
| GET | `/api/videos/music` | 列出 `MUSIC_DIR` 下可用曲目 |
| GET | `/api/videos/:name` | 播放/下载产物 |
| DELETE | `/api/videos/:name` | 删除产物 |

写操作沿用可选鉴权（`x-access-token`，见 `server/auth.js`）。注意 Express 匹配顺序：`/music`、`/jobs/:id` 等字面/具体路由须在 `/:name` 之前注册。

### `server/analyze.js`

Provider 接口占位，签名与实现解耦，便于后续接云端或本地 VLM：

```js
// 返回每素材评分/标签：{ fileName, score, sharpness, exposure, phash, reasons[] }
export async function analyzeAssets(files, opts = {}) { ... }
```

- 默认 provider `heuristic`（纯 sharp，无联网/无模型）：
  - 清晰度：拉普拉斯方差（转灰度后卷积）。
  - 曝光：直方图过曝/欠曝比例。
  - 分辨率/长宽比。
  - 去重：dHash 感知哈希，相似度超阈值判为雷同。
- 用途：自动剔废片、择优排序、超量素材采样。

### `server/video-render.js`

两阶段渲染，复用 `upload.js` 的 `resolveFfmpeg()`（NVENC 优先，失败回退 CPU）。

**阶段一（逐素材 → 统一规格中间片段）**
- 照片：`zoompan` Ken Burns 推拉（默认每张约 3s）。
- 视频：转统一 H.264/AAC、目标 fps、≤5s 裁剪、保留原声。
- 统一输出到临时目录（渲染结束清理）。

**阶段二（合成）**
- `xfade` 叠化拼接（默认 0.5s）。
- `ass` 烧中文字幕。
- 音频：BGM 全程 + 视频原声 `amix` 混音（照片段仅 BGM）。
- 画幅：16:9 直适配；9:16 横图"模糊背景 + 居中"，视频居中裁剪。

## 字幕（ASS）

- 按 `takenAt` 生成 `.ass`：片头大标题 = 地点名 + 日期范围（`YYYY.MM`）+ 张数。
- `ass`/`subtitles` 滤镜使用 `fontname`；字体名由 `VIDEO_FONT` 覆盖：
  - Linux 默认 `Noto Sans CJK SC`
  - Windows 默认 `Microsoft YaHei`
- **只用系统字体**：`ffmpeg -filters` 实测 `ffmpeg-static` 无 `drawtext` 但有 `ass/subtitles`(libass)、两个构建均 `--enable-fontconfig`，故字幕统一走 ASS。系统无中文字体时**静默无字幕并告警**。
- README/AGENTS 补一句 `sudo apt install fonts-noto-cjk`（Linux）。

## 参数与默认值

| 参数 | 默认 | 说明 |
|---|---|---|
| 目标时长 | 约 60s | 时长档：短≈30s / 中≈60s / 长≈120s |
| 照片每张 | 约 3s | 含转场重叠 |
| 转场 | 0.5s xfade | |
| 视频片段 | ≤5s | 保留原声 |
| 超量处理 | 均匀采样 | 优先保留视频、优先高分素材 |

## 前端

- **MapPage**：地点信息面板加"生成旅行视频"按钮 → 打开筛选+参数对话框（复用 `src/components/PhotoGrid.jsx`）。
- 对话框：素材网格（默认全选，可勾掉/全选/反选）+ 画幅/BGM/时长档选择 + 生成按钮（全不选禁用）。
- 进度条：复用 import 的 job 轮询模式。
- 完成后内嵌 `<video>` 预览 + 下载。
- 新增路由 `/videos`「我的成片」页（列出 exports，播放/下载/删除）。
- API 封装进 `src/api.js`。

## 路径与配置

`server/paths.js` 新增：

```js
export const EXPORTS_DIR = path.resolve(process.env.EXPORTS_DIR || path.join(BASE_DIR, 'exports'))
export const MUSIC_DIR   = path.resolve(process.env.MUSIC_DIR   || path.join(DATA_DIR, 'music'))
```

产物命名 `<地点>-<时间戳>.mp4`。路由挂载进 `server/index.js`，前端路由加 `/videos`。

## 错误处理

- 逐素材容错：单张失败跳过并计数，不中断整体。
- 渲染失败保留 ffmpeg stderr 摘要（含 NVENC→CPU 回退原因）。
- 临时中间文件在任务结束（成功或失败）后清理。
- 无可用素材 / 全不选 → 400，前端禁用。

## 测试与验证

- `npm test` 新增：
  - `video-render.test.js`：ASS 生成、素材采样/排序、ffmpeg 参数构造（不真跑 ffmpeg）。
  - `analyze.test.js`：择优指标（清晰度/曝光/去重阈值）。
- 手测：真实渲染 16:9 与 9:16 各一条，检查运镜、转场、视频原声、BGM、字幕。

## 风险

- 系统缺中文字体 → 无字幕（已接受，告警）。
- 大地点上百张素材渲染慢 → 后台任务 + 进度条缓解。
- 9:16 竖版排版（模糊背景/裁剪）效果需实测定稿。
- 便携包依赖宿主机中文字体（Windows 自带微软雅黑可用；精简 Linux 需安装）。
