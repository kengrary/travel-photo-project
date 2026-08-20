# 旅行照片地图 (Travel Photo Map)

把旅行照片按拍摄地点展示在地图上的小工具。上传照片后自动读取 GPS 信息，逆地理编码出省/市/县，未定位的照片可在地图上手动点击补位。

## 首次运行

```bash
npm install
npm run bootstrap:geo   # 下载中国边界数据（必须，git-ignored，每个克隆都要重新执行）
npm run dev             # 或 npm run build && npm run start
```

## 页面

- **地图** (`/`): 按省/市/县聚簇展示照片拍摄地。
- **上传** (`/upload`): 上传照片，自动定位；无 GPS 或解析失败的照片进入手动定位流程。
- **照片墙** (`/wall`): 按时间倒序浏览所有照片。

照片及其缩略图保存在本地（SQLite `server/data/app.db` 和 `uploads/`），不上传任何外部服务。

## 脚本

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 开发模式（前后端热更新） |
| `npm run build` | 构建前端到 `dist/` |
| `npm start` | 启动生产服务 |
| `npm test` | 运行服务端测试 |
| `npm run bootstrap:geo` | 下载中国边界数据到 `server/data/geojson/` |