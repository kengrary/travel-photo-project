# 构建参数（国内网络可覆盖，例如：
#   docker build -t travel-photo-map \
#     --build-arg NODE_IMAGE=docker.m.daocloud.io/library/node:20-slim \
#     --build-arg NPM_REGISTRY=https://registry.npmmirror.com \
#     --build-arg FFMPEG_BINARIES_URL=https://registry.npmmirror.com/-/binary/ffmpeg-static .
ARG NODE_IMAGE=node:20-slim
ARG NPM_REGISTRY=https://registry.npmjs.org
ARG FFMPEG_BINARIES_URL=https://github.com/eugeneware/ffmpeg-static/releases

# 构建阶段：安装依赖（含原生模块编译工具链）+ 编译前端 + 裁剪出生产依赖
FROM ${NODE_IMAGE} AS build
ARG NPM_REGISTRY
ARG FFMPEG_BINARIES_URL
ENV FFMPEG_BINARIES_URL=${FFMPEG_BINARIES_URL}
WORKDIR /app
# python3/make/g++：better-sqlite3 等原生模块预编译包下载失败时的编译兜底
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm config set registry ${NPM_REGISTRY} && npm ci
COPY . .
RUN npm run build \
  && npm prune --omit=dev

# 运行阶段：仅带生产依赖与构建产物
FROM ${NODE_IMAGE}
ENV NODE_ENV=production
WORKDIR /app
# ffmpeg 供视频转码使用（upload.js 会自动探测系统 ffmpeg）
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY server ./server
COPY --from=build /app/dist ./dist
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3000
VOLUME ["/app/server/data", "/app/uploads"]
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server/index.js"]
