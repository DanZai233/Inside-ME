#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f "$ROOT/.venv/bin/activate" ]]; then
  echo "未找到 .venv：请先执行 python3 -m venv .venv && source .venv/bin/activate && pip install -e '.[dev]'" >&2
  exit 1
fi

# shellcheck source=/dev/null
source "$ROOT/.venv/bin/activate"

cleanup() { kill 0 2>/dev/null || true; }
trap cleanup EXIT INT TERM

uvicorn inside_me.app:app --host 127.0.0.1 --port 8000 --reload &
(cd "$ROOT/frontend" && npm run dev)
wait
