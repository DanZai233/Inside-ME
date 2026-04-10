# 前端构建
FROM node:22-bookworm-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# 运行时：单进程 uvicorn，同端口提供 /api 与静态页
FROM python:3.12-slim-bookworm AS runtime
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml README.md ./
COPY src ./src
RUN pip install --no-cache-dir --upgrade pip setuptools wheel \
    && pip install --no-cache-dir .

COPY --from=frontend /app/frontend/dist /app/static

ENV INSIDE_ME_DATA_DIR=/data \
    INSIDE_ME_STATIC_DIR=/app/static \
    INSIDE_ME_CORS_ORIGINS=http://localhost:8080,http://127.0.0.1:8080

RUN mkdir -p /data
VOLUME ["/data"]
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=6s --start-period=60s --retries=3 \
  CMD python -c "import urllib.request as u; u.urlopen('http://127.0.0.1:8000/health', timeout=5).read()"

CMD ["uvicorn", "inside_me.app:app", "--host", "0.0.0.0", "--port", "8000"]
