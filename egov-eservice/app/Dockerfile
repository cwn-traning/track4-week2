FROM node:20-bookworm-slim
# เครื่องมือ build สำรองสำหรับ better-sqlite3 (ปกติใช้ prebuilt binary)
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY src ./src
COPY public ./public
ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/data/egov.db
RUN mkdir -p /data
EXPOSE 3000
CMD ["node", "src/server.js"]
