# 中之我（Inside-ME）

在**本地**解析聊天记录、写入向量库（Chroma）、维护可编辑画像，并用 **OpenAI 兼容 API** 做多轮对话与 **RAG**；可导出符合 [Agent Skills](https://agentskills.io/specification) 的 `SKILL.md` 数字分身目录。数据默认只落在本机目录，**可 Docker 一键部署**。

## 功能概览

| 模块 | 说明 |
|------|------|
| **仪表盘** | 消息量、平台分布、发送者抽样、相邻对话对、高频词、画像笔记（可保存 / 统计刷新 / 模型生成摘要） |
| **导入** | 支持 QQ / 微信风格 / 微博时间块 / 通用逐行等解析，写入向量库并合并画像统计 |
| **对话** | **流式**回复（SSE）；左侧**记忆档案**（输入时 RAG 预览、发送后本轮注入高亮、流式过程中抽屉**逐步点亮**）；**钉选**单条优先进上下文；摘要可**点击或「插入输入」**写入输入框；预置**开场白**；可选**深度访谈模式** |
| **写入记忆** | 勾选「将每轮对话写入本地记忆库」时，每轮用户句 + 助手完整回复会**向量化入库**，与导入记录一起参与后续检索（API 字段 `persist_to_memory`，默认 `true`） |
| **导出 Skill** | 生成本地 `exports/<name>/` 目录（含 `SKILL.md`、`references/MEMORY.md` 等） |
| **模型设置** | Base URL、API Key、对话模型；可选**云端向量**（与对话模型分离的 Embedding 接入点）、方舟 multimodal 嵌入等 |

## 环境要求

- Python 3.11+
- Node.js 20+（仅本地前端开发；Docker 镜像内已构建静态资源）

## 本地安装

```bash
cd /path/to/Inside-ME
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -e ".[dev]"
```

若 `pip install` 出现 **`SSLEOFError` / SSL 握手被中断**，多为到 `pypi.org` 的 TLS 路径问题，可换 **PyPI 镜像**：

```bash
export INSIDE_ME_PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple
./scripts/bootstrap-venv.sh
```

（其他镜像示例：`https://mirrors.aliyun.com/pypi/simple/`。）也可手动：

```bash
pip install -i https://pypi.tuna.tsinghua.edu.cn/simple \
  --trusted-host pypi.tuna.tsinghua.edu.cn \
  -U pip setuptools wheel
pip install -i https://pypi.tuna.tsinghua.edu.cn/simple \
  --trusted-host pypi.tuna.tsinghua.edu.cn \
  -e ".[dev]"
```

若仍失败，可检查 `python3 -c "import ssl; print(ssl.OPENSSL_VERSION)"`、`curl -I https://pypi.org/simple`，以及 `HTTPS_PROXY`、本机 OpenSSL/Python 版本等。

### 启动 API

```bash
inside-me serve
# 开发热重载
inside-me serve --reload
# 或
uvicorn inside_me.app:app --host 127.0.0.1 --port 8000
```

默认 **http://127.0.0.1:8000**；OpenAPI 文档：**http://127.0.0.1:8000/docs**。

### CLI

```bash
inside-me import ./exports/chat.txt
inside-me skill my-inside-me --out ./dist-skills
```

## 前端（开发）

```bash
cd frontend
npm install
npm run dev
```

一般为 **http://localhost:5173**，通过 Vite 代理访问后端 **`/api`** 与 **`/health`**。

一键前后端（需已完成 venv 与 `frontend/npm install`）：

```bash
./scripts/dev.sh
```

### 生产：同源托管（可选）

构建静态资源后，让后端同时提供页面与 API（与 Docker 行为一致）：

```bash
cd frontend && npm run build
cd ..
export INSIDE_ME_STATIC_DIR="$(pwd)/frontend/dist"
uvicorn inside_me.app:app --host 0.0.0.0 --port 8000
```

浏览器访问 **http://127.0.0.1:8000** 即可。

## 数据存哪儿？持久化吗？

全部是**磁盘文件**，无独立数据库服务；**重启后仍在**，除非删除数据目录或 Docker 卷。

| 内容 | 默认位置 | 说明 |
|------|-----------|------|
| 向量库（Chroma） | `~/.inside-me/chroma/` 或 `chroma_remote/` | 导入消息、对话写入记忆等；含嵌入与元数据（平台、发送者、时间等） |
| API / 模型设置 | `~/.inside-me/settings.json` | Base URL、Key、云端向量开关等 |
| 画像 | `~/.inside-me/profile.json` | 摘要与笔记 |
| Skill 导出 | `~/.inside-me/exports/<name>/` | 导出命令生成 |

## 环境变量（`INSIDE_ME_*`）

| 变量 | 含义 |
|------|------|
| **`INSIDE_ME_DATA_DIR`** | 数据根目录（默认 `~/.inside-me`） |
| **`INSIDE_ME_STATIC_DIR`** | 指向前端 `dist` 目录时，在**同一端口**托管静态站 + `/api` |
| **`INSIDE_ME_CORS_ORIGINS`** | 逗号分隔的浏览器来源，开发默认含 `localhost:5173`；改端口时需同步修改 |

其他子路径、文件名见 `src/inside_me/config.py`（如 `chroma_subdir` 等）。

## Docker 一键部署

需安装 [Docker](https://docs.docker.com/get-docker/) 与 **Docker Compose v2**。

```bash
cd /path/to/Inside-ME
docker compose up -d --build
```

浏览器打开 **http://localhost:8080**（容器内 `8000` 映射到宿主机 `8080`，页面与 API 同源）。

- **持久化**：命名卷 **`inside_me_data`** → 容器内 **`/data`**，删容器不丢向量与设置。若要绑定宿主机目录，可将 `docker-compose.yml` 中 `volumes` 改为例如 `- ./inside-me-data:/data`。
- **改端口**：修改 `ports`（如 `"3000:8000"`），并把 **`INSIDE_ME_CORS_ORIGINS`** 设为你在地址栏使用的来源（如 `http://localhost:3000`）。
- **仅构建镜像**：`docker build -t inside-me .`

不用 Compose 的示例（镜像名与 `docker build -t` 一致即可）：

```bash
docker run -d --name inside-me -p 8080:8000 -v inside_me_data:/data inside-me:local
```

## 火山引擎（方舟）与本地向量

- **对话与摘要**：「模型设置」中 Base URL 设为 `https://ark.cn-beijing.volces.com/api/v3`，Key 用方舟令牌，**对话模型**填 Chat 接入点（如 `ep-xxxx`）。后端请求 `…/api/v3/chat/completions`（流式为 SSE），与 OpenAI `…/v1/chat/completions` 自动区分。
- **嵌入 / RAG**：若本机 Chroma 默认 ONNX 因网络 TLS 失败，可勾选 **使用云端向量**，并填写**单独的 Embedding 接入点**（与对话 `ep-` 不是同一个）。纯文本走 `…/embeddings`；**doubao-embedding-vision-*** 等走 `…/embeddings/multimodal`（应用内已按文本封装）。模型名含 `embedding-vision` 时会自动选用 multimodal，也可勾选强制。向量目录为 **`chroma_remote/`**，**切换后需重新导入**。
- **代理 SSL 问题**：可尝试 `export INSIDE_ME_HTTP_TRUST_ENV=0`，使对话与嵌入请求不自动继承环境变量里的 `HTTP(S)_PROXY`（见 `openai_compat.py`）。

## 隐私说明

- 聊天记录与向量默认只写入本机（或你所挂载的）数据目录。
- 仅在「模型设置」中配置 API Key 并调用对话、摘要、云端嵌入或「用模型导出」时，才会向你配置的**兼容端点**发网。

## 仓库结构

- `src/inside_me/`：解析、Chroma、画像、Skill 生成、FastAPI、`POST /api/chat` 与 **`POST /api/chat/stream`** 等
- `frontend/`：React + Vite 界面
- `Dockerfile`、`docker-compose.yml`：镜像与 Compose 启动
- `scripts/`：本地开发脚本等

## 许可证

MIT
