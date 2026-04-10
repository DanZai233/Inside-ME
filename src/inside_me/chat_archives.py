from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

_MAX_ARCHIVES = 48


def _read(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return []
    if isinstance(data, list):
        return [x for x in data if isinstance(x, dict)]
    return []


def _write(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")


def list_archives(path: Path) -> list[dict[str, Any]]:
    rows = _read(path)
    out = []
    for r in rows:
        mid = str(r.get("id") or "")
        if not mid:
            continue
        msgs = r.get("messages")
        n = len(msgs) if isinstance(msgs, list) else 0
        out.append(
            {
                "id": mid,
                "name": str(r.get("name") or "未命名"),
                "created_at": str(r.get("created_at") or ""),
                "updated_at": str(r.get("updated_at") or ""),
                "message_count": n,
            }
        )
    out.sort(key=lambda x: x.get("updated_at") or "", reverse=True)
    return out


def get_archive(path: Path, aid: str) -> dict[str, Any] | None:
    aid = (aid or "").strip()
    if not aid:
        return None
    for r in _read(path):
        if str(r.get("id") or "") == aid:
            return r
    return None


def create_archive(
    path: Path,
    *,
    name: str,
    messages: list[dict[str, str]],
    extra_system: str | None,
) -> dict[str, Any]:
    rows = _read(path)
    now = datetime.now(UTC).isoformat()
    aid = uuid.uuid4().hex
    item = {
        "id": aid,
        "name": name.strip()[:120] or "未命名存档",
        "created_at": now,
        "updated_at": now,
        "messages": messages[:400],
        "extra_system": (extra_system or "").strip()[:8000] or None,
    }
    rows.insert(0, item)
    rows = rows[:_MAX_ARCHIVES]
    _write(path, rows)
    return item


def delete_archive(path: Path, aid: str) -> bool:
    aid = (aid or "").strip()
    if not aid:
        return False
    rows = _read(path)
    new = [r for r in rows if str(r.get("id") or "") != aid]
    if len(new) == len(rows):
        return False
    _write(path, new)
    return True
