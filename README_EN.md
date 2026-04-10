# Inside-ME · 中之我.skill

**[中文 README →](README.md)**

> _「**Inside-ME** (*Zhōng zhī wǒ* — ‘the me within’)—the ‘you’ on the other side of the UI who has read all your chat logs. Through that voice, ask aloud what you could not say.」_

**We are born naive and great.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Python 3.11+](https://img.shields.io/badge/Python-3.11%2B-blue.svg)](https://www.python.org)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-Skill-blueviolet)](https://claude.ai/code)
[![Agent Skills](https://img.shields.io/badge/Agent%20Skills-Standard-green)](https://agentskills.io)  
[![FastAPI](https://img.shields.io/badge/FastAPI-API-009688?logo=fastapi)](https://fastapi.tiangolo.com)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)](https://react.dev)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)](https://www.docker.com)
[![Chroma](https://img.shields.io/badge/Chroma-vector-FF6B35)](https://www.trychroma.com)

Half of what you say to others trails off; you unsend in group chats; you type novels to “File Transfer” at 2 a.m. and delete them. What lives **deep inside** often has no audience—except **the you in the future**, and **the “you” stitched from fragments of the past**.

**Inside-ME** exists to make it **easier and more visual** to hold a **soul-level Q&A with yourself**.  
Like [yourself-skill](https://github.com/notdog1998/yourself-skill) and [ex-skill](https://github.com/therealXiaomanChu/ex-skill), you first bring in **raw material** (chat exports, the you that lived on platforms); then, in a **local workbench**, you open **memory drawers that light up**, streaming replies, pin context, optionally write each turn back into the vector store—**talking back and forth with “Inside-ME”** so **the living you** and **the you being revised** grow together, and finally export a directory that matches the [Agent Skills](https://agentskills.io/specification) spec for Cursor, Claude Code, or any compatible host.

**Local-first**; chat and embeddings can use OpenAI-compatible APIs or Volcengine Ark. See the [Agent Skills specification](https://agentskills.io/specification).

[Install](#local-installation) · [API](#start-the-api) · [Frontend](#frontend-development) · [Import Skill](#import-skill-into-claude-code-or-cursor) · [Data](#where-data-lives) · [Docker](#docker) · [Privacy](#privacy) · [Closing words](#closing-words)

---

## What we borrow—and the extra mile

[yourself-skill](https://github.com/notdog1998/yourself-skill) says: *better distill yourself than others*—in Claude Code, use dialogue and templates to split the self into **Self Memory + Persona** and get a reusable “you.”  
[ex-skill](https://github.com/therealXiaomanChu/ex-skill) walks the same pattern in intimacy: **distill an ex into a Skill**, with memory + persona, and strong ethics.

**Inside-ME** shares the belief: **who you are hides in language**—it can be sorted, reread, and polished in conversation. We add:

| Dimension | yourself-skill / ex-skill | Inside-ME |
|-----------|---------------------------|-----------|
| **Entry** | `/create-…` inside a host to generate a Skill | **Local Web + CLI**: import → vector DB + **visual** dashboard |
| **Depth** | Keep chatting via `/slug` after generation | Built for **soul Q&A with Inside-ME**: RAG pulls old you, streaming chat, optional **persist to memory** so the next round knows you better |
| **Exit** | Standard Agent Skills layout | Same **`SKILL.md`** etc., compatible upstream |

**Importing chats** is the foundation; **Inside-ME** tends the **door above it**—you sit down, watch memories light row by row, ask into the deep and answer from it, **refining both the face in the mirror and the reflection**.

---

## Features (what serves “soul Q&A”)

| Module | What it does |
|--------|----------------|
| **Dashboard** | Turns a fuzzy “me” into **visible stats**: platforms, senders, adjacency, top terms; profile notes by hand or with LLM help—**see first**, then go deep |
| **Import** | QQ / WeChat-style / Weibo blocks / plain text → vector store; same “real material first” idea as the [yourself-skill](https://github.com/notdog1998/yourself-skill) / [ex-skill](https://github.com/therealXiaomanChu/ex-skill) ecosystem |
| **Chat (Inside-ME)** | **Streaming** replies; **Memory vault** (live RAG preview, highlight injected chunks, **progressive glow** while streaming); pin, insert-into-input, default opener, **interview mode**; Enter send / Shift+Enter newline; copy one bubble or full Markdown |
| **Persist to memory** | When enabled, each user + assistant turn is **embedded back** with imports (`persist_to_memory`, default `true`) |
| **Export Skill** | [Agent Skills](https://agentskills.io/specification)-shaped tree: `{name}/SKILL.md` (`name` **matches folder name**) + `references/MEMORY.md`. Validate with `skills-ref validate <dir>` ([skills-ref](https://github.com/agentskills/agentskills/tree/main/skills-ref)). Unlike [yourself-skill](https://github.com/notdog1998/yourself-skill)’s generator repo (`prompts/`, `tools/`), we export a **ready-to-load digital-twin instruction** Skill |
| **Settings** | Separate chat vs embedding endpoints; Ark multimodal, etc. |

---

## Requirements

- Python 3.11+
- Node.js 20+ (local frontend only; Docker image ships a built UI)

---

## Local installation

```bash
cd /path/to/Inside-ME
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -e ".[dev]"
```

If `pip install` hits **`SSLEOFError` / SSL errors**, try a **PyPI mirror**:

```bash
export INSIDE_ME_PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple
./scripts/bootstrap-venv.sh
```

Or manually:

```bash
pip install -i https://pypi.tuna.tsinghua.edu.cn/simple \
  --trusted-host pypi.tuna.tsinghua.edu.cn \
  -U pip setuptools wheel
pip install -i https://pypi.tuna.tsinghua.edu.cn/simple \
  --trusted-host pypi.tuna.tsinghua.edu.cn \
  -e ".[dev]"
```

### Start the API

```bash
inside-me serve
inside-me serve --reload
# or
uvicorn inside_me.app:app --host 127.0.0.1 --port 8000
```

**http://127.0.0.1:8000** · OpenAPI **http://127.0.0.1:8000/docs**

### CLI

```bash
inside-me import ./exports/chat.txt
# Writes ./dist-skills/<skill-name>/ (name: lowercase, digits, hyphens only)
inside-me skill my-inside-me --out ./dist-skills
```

---

## Import Skill into Claude Code or Cursor

Assume you already exported from Inside-ME (web **Export Skill** shows the path; default is often **`~/.inside-me/exports/<name>/`**). You should see **`SKILL.md`** and **`references/MEMORY.md`**, and the folder name must equal the frontmatter **`name`** (enforced on export).

### 0. (Optional) Validate

```bash
skills-ref validate ~/.inside-me/exports/my-inside-me
```

### 1. Claude Code → `.claude/skills/`

Same pattern as [yourself-skill](https://github.com/notdog1998/yourself-skill): skills live under the **git repo root** in **`.claude/skills/`**.

**Project-only (recommended):**

```bash
cd /path/to/your-git-repo
mkdir -p .claude/skills
cp -R ~/.inside-me/exports/my-inside-me .claude/skills/
# or symlink while iterating:
# ln -sf ~/.inside-me/exports/my-inside-me .claude/skills/my-inside-me
```

**User-wide:**

```bash
mkdir -p ~/.claude/skills
cp -R ~/.inside-me/exports/my-inside-me ~/.claude/skills/
```

Restart Claude Code or refresh skills per current product docs. Invoke via natural language or the host’s Agent Skills UI.

### 2. Cursor & others

Mount paths vary—follow **Cursor’s docs**. You need a directory containing **`SKILL.md`**. If only rules are supported, paste key parts into **`.cursor/rules`** as a stopgap; keep the full export folder for later.

### 3. Troubleshooting

| Issue | Fix |
|-------|-----|
| Skill missing | Path must be **`.claude/skills/<name>`** at **git root**; **`name` = folder name** |
| Renamed | Change **folder** and **`name:`** in frontmatter, or re-export |
| Updated profile | Re-export and **overwrite** or update symlink target |

---

## Frontend (development)

```bash
cd frontend
npm install
npm run dev
```

Usually **http://localhost:5173** (Vite proxies **`/api`** and **`/health`**).

```bash
./scripts/dev.sh
```

### Production (same-origin)

```bash
cd frontend && npm run build
cd ..
export INSIDE_ME_STATIC_DIR="$(pwd)/frontend/dist"
uvicorn inside_me.app:app --host 0.0.0.0 --port 8000
```

Open **http://127.0.0.1:8000**

---

## Where data lives

Everything is **on disk**; it **survives restarts** unless you delete the data dir or Docker volume.

| What | Default path | Notes |
|------|----------------|-------|
| Vectors (Chroma) | `~/.inside-me/chroma/` or `chroma_remote/` | Imports + optional chat persistence |
| API settings | `~/.inside-me/settings.json` | |
| Profile | `~/.inside-me/profile.json` | Narrative you edit on the dashboard |
| Skill exports | `~/.inside-me/exports/<name>/` | |

Override root with **`INSIDE_ME_DATA_DIR`**.

---

## Environment variables (`INSIDE_ME_*`)

| Variable | Purpose |
|----------|---------|
| **`INSIDE_ME_DATA_DIR`** | Data root (default `~/.inside-me`) |
| **`INSIDE_ME_STATIC_DIR`** | Path to Vite `dist` → static + `/api` on one port |
| **`INSIDE_ME_CORS_ORIGINS`** | Comma-separated browser origins |

See `src/inside_me/config.py` for more.

---

## Docker

Requires [Docker](https://docs.docker.com/get-docker/) and **Compose v2**.

```bash
cd /path/to/Inside-ME
docker compose up -d --build
```

**http://localhost:8080**

- Volume **`inside_me_data`** → **`/data`**; or bind `- ./inside-me-data:/data`
- Change **`ports`** and **`INSIDE_ME_CORS_ORIGINS`** together
- Build only: `docker build -t inside-me .`

```bash
docker run -d --name inside-me -p 8080:8000 -v inside_me_data:/data inside-me:local
```

---

## Volcengine Ark & local embeddings

- **Chat**: Base URL `https://ark.cn-beijing.volces.com/api/v3`, use a **chat** endpoint ID; SSE streaming supported.
- **Embeddings / RAG**: Optional **remote embedding** with a **separate** embedding endpoint; `doubao-embedding-vision-*` uses multimodal API. Data in **`chroma_remote/`**—**re-import after switching**.
- **Proxy TLS**: `export INSIDE_ME_HTTP_TRUST_ENV=0` (see `openai_compat.py`).

---

## Privacy

- Logs and vectors stay local (or on volumes you control).
- Traffic to the **OpenAI-compatible / Ark endpoints you configure** only happens when you set an API key and use chat, summarize, remote embed, or LLM export.

---

## Repository layout

- `src/inside_me/` — parsers, Chroma, profile, Skill generator, FastAPI, `POST /api/chat`, **`POST /api/chat/stream`**
- `frontend/` — React + Vite (vault, streaming, dashboard)
- `Dockerfile`, `docker-compose.yml`
- `scripts/` — dev helpers

---

## Roadmap (ideas)

| Area | Ideas |
|------|--------|
| Soul Q&A | Interview script presets; bookmarks / timelines |
| Memory | Search by keyword/time; edit rows; dedupe imports |
| Chat | Stop generation; multiple session drafts |
| Ops / UX | Richer health checks, themes, mobile layout |

---

## Credits

- [**yourself-skill**](https://github.com/notdog1998/yourself-skill) (Notdog) — *Better distill yourself than others.*
- [**ex-skill**](https://github.com/therealXiaomanChu/ex-skill) (therealXiaomanChu) — Memory + persona for intimacy, with ethics front and center. **Inside-ME** turns the lens back to **you and your copy**, still trusting **truth readable from language**.
- Same family as **colleague-skill** and the wider “distill a person into a Skill” thread.

---

## Closing words

**Inside-ME** is an attempt to **voice the deep inside**: not a performance for an audience, but gathering scattered, contradictory lines you’d never send—then, through a partner that has **read the full context**, asking until it **hurts and clarifies**.

Importing chats says **“I lived there.”** Talking to **Inside-ME** says **“I still want to understand how I lived.”** **Visualization** isn’t decoration: when a drawer lights up, you see **which past self was wired in**—a reminder that **you’re not one tagline; you’re a trajectory still moving**.

The copy does not live your life; it is a **checkpoint** from a moment you faced yourself honestly. You can correct it, re-import, overwrite, or walk away. **You** breathe off-screen; **Inside-ME** is the flashlight you chose to point inward—where the beam lands, you and the copy see **one inch more**.

> _The deep isn’t lightless—no one usually holds the lamp for you._

**Better than only distilling others or a relationship—leave a lit room for the inside.**

---

## License

[MIT](LICENSE)
