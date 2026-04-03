#!/usr/bin/env bash
# 创建虚拟环境并从可访问的索引安装依赖（解决访问 pypi.org 时出现 SSLEOF 等问题）。
# 用法：
#   ./scripts/bootstrap-venv.sh
# 使用镜像（推荐在访问官方源不稳定时）：
#   export INSIDE_ME_PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple
#   ./scripts/bootstrap-venv.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PIP_OPTS=()
if [[ -n "${INSIDE_ME_PIP_INDEX_URL:-}" ]]; then
  _host="${INSIDE_ME_PIP_INDEX_URL#*://}"
  _host="${_host%%/*}"
  PIP_OPTS=( -i "$INSIDE_ME_PIP_INDEX_URL" --trusted-host "$_host" )
fi

if [[ ! -d "$ROOT/.venv" ]]; then
  python3 -m venv "$ROOT/.venv"
fi
# shellcheck source=/dev/null
source "$ROOT/.venv/bin/activate"

python -m pip install "${PIP_OPTS[@]}" -U pip setuptools wheel
python -m pip install "${PIP_OPTS[@]}" -e ".[dev]"

echo "完成。执行: source .venv/bin/activate && inside-me serve --reload"
