# 中之我（Inside-ME）

开源「自我蒸馏」工具：在**本地**解析聊天记录、写入向量库（Chroma）、维护可编辑画像，并支持 OpenAI 兼容 API 的对话与 RAG；可导出符合 [Agent Skills](https://agentskills.io/specification) 规范的 `SKILL.md` 数字分身目录。

## 环境要求

- Python 3.11+
- Node.js 20+（仅前端）

## 后端（CLI + API）

```bash
cd /path/to/Inside-ME
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -e ".[dev]"
```

若 `pip install` 在拉取 `setuptools` 时出现 **`SSLEOFError` / SSL 握手被中断**，多为网络或本机到 `pypi.org` 的 TLS 路径异常（代理、防火墙、地区线路等）。可先换 **PyPI 镜像** 再装：

```bash
export INSIDE_ME_PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple
./scripts/bootstrap-venv.sh
```

（其他镜像示例：`https://mirrors.aliyun.com/pypi/simple/`。）也可自行一次性安装：

```bash
pip install -i https://pypi.tuna.tsinghua.edu.cn/simple \
  --trusted-host pypi.tuna.tsinghua.edu.cn \
  -U pip setuptools wheel
pip install -i https://pypi.tuna.tsinghua.edu.cn/simple \
  --trusted-host pypi.tuna.tsinghua.edu.cn \
  -e ".[dev]"
```

若换镜像仍失败，请在系统终端执行 `python3 -c "import ssl; print(ssl.OPENSSL_VERSION)"` 与 `curl -I https://pypi.org/simple`，并检查是否需配置 `HTTPS_PROXY` 或更新 Python/OpenSSL（Homebrew：`brew reinstall python@3.12` 等）。

```bash
# 启动 API（默认 http://127.0.0.1:8000）
inside-me serve
# 开发热重载
inside-me serve --reload
# 或
uvicorn inside_me.app:app --host 127.0.0.1 --port 8000
```

### CLI

```bash
inside-me import ./exports/chat.txt
inside-me skill my-inside-me --out ./dist-skills
```

数据目录默认为 `~/.inside-me`（向量库、画像 JSON、API 设置、导出 skill）。可通过环境变量 `INSIDE_ME_DATA_DIR` 设为任意绝对或相对路径。

### 火山引擎（方舟）与本地向量

- **对话与摘要**：在「模型设置」中将 Base URL 设为 `https://ark.cn-beijing.volces.com/api/v3`，API Key 使用方舟令牌，「对话模型」填控制台中的推理接入点（如 `ep-xxxx`）。后端会请求 `…/api/v3/chat/completions`，与 OpenAI 的 `…/v1/chat/completions` 自动区分。
- **嵌入 / RAG**：若本机拉取 Chroma 默认 ONNX 模型因网络或代理出现 TLS 错误，请在设置中勾选 **使用云端向量**，并填写方舟里单独开通的 **Embedding 接入点**（与对话用的 `doubao-seed-…` / `ep-` **不是同一个**）。纯文本模型走 `…/api/v3/embeddings`；**doubao-embedding-vision-*** 等多模态模型走 `…/api/v3/embeddings/multimodal`，请求体为 `[{type:text,text:…}]`（应用内已按每条消息自动封装）。模型名含 `embedding-vision` 时会自动选用 multimodal；否则可勾选「强制 multimodal」。向量在 `~/.inside-me/chroma_remote/`，**切换后需重新导入**。
- **代理导致 SSL 中断**：可尝试在运行前设置 `export INSIDE_ME_HTTP_TRUST_ENV=0`，让对外请求（对话、嵌入）不走环境变量里的 `HTTP(S)_PROXY`。

## 前端

```bash
cd frontend
npm install
npm run dev
```

浏览器打开 Vite 提示的地址（一般为 http://localhost:5173）。开发模式下通过代理访问后端 `/api` 与 `/health`。

### 同时启动前后端（本机）

需已创建 `.venv` 并完成 `pip install` 与 `frontend/npm install` 后：

```bash
./scripts/dev.sh
```

## 隐私说明

- 聊天记录与向量默认只写入本机数据目录。
- 仅在你在「模型设置」中填写 API Key 并调用对话、摘要或「用模型导出」时，才会向你所配置的 OpenAI 兼容端点发送请求。

## 仓库结构

- `src/inside_me/`：Python 包（解析、Chroma、画像、Skill 生成、FastAPI、CLI）
- `frontend/`：React + Vite 仪表盘与对话界面

## 许可证

MIT
