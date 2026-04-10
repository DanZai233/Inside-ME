from __future__ import annotations

import logging
import threading
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from inside_me.analysis.profile import (
    build_profile_from_store,
    load_profile,
    merge_profile_json,
    save_profile,
)
from inside_me.config import Settings
from inside_me.parsers import parse_chat_file
from inside_me.prefs import load_user_settings
from inside_me.store import MessageStore

logger = logging.getLogger(__name__)

_lock = threading.Lock()
_jobs: dict[str, dict[str, Any]] = {}

EMBED_CHUNK = 80


def create_job(original_filename: str) -> str:
    jid = uuid.uuid4().hex
    with _lock:
        _jobs[jid] = {
            "status": "queued",
            "filename": original_filename,
            "cancel": threading.Event(),
            "parsed_total": None,
            "embedded_done": 0,
            "embedded_total": None,
            "imported": None,
            "skipped_duplicates": None,
            "platform": None,
            "error": None,
        }
    return jid


def get_public_state(jid: str) -> dict[str, Any] | None:
    with _lock:
        j = _jobs.get(jid)
        if not j:
            return None
        return {
            "status": j["status"],
            "filename": j["filename"],
            "parsed_total": j["parsed_total"],
            "embedded_done": j["embedded_done"],
            "embedded_total": j["embedded_total"],
            "imported": j["imported"],
            "skipped_duplicates": j["skipped_duplicates"],
            "platform": j["platform"],
            "error": j["error"],
        }


def request_cancel(jid: str) -> bool:
    with _lock:
        j = _jobs.get(jid)
        if not j or j["status"] in ("done", "error", "cancelled"):
            return False
        j["cancel"].set()
        return True


def _update(jid: str, **kwargs: Any) -> None:
    with _lock:
        if jid in _jobs:
            _jobs[jid].update(kwargs)


def run_import_job(jid: str, file_path: Path, dedupe: bool, settings: Settings) -> None:
    """FastAPI BackgroundTasks：读临时文件 → 解析 → 分批写入向量库 → 刷新画像。"""
    try:
        raw = file_path.read_text(encoding="utf-8", errors="replace")
    except Exception as e:
        logger.exception("import job read failed")
        _update(jid, status="error", error=str(e))
        try:
            file_path.unlink(missing_ok=True)
        except OSError:
            pass
        return
    try:
        file_path.unlink(missing_ok=True)
    except OSError:
        pass

    with _lock:
        j = _jobs.get(jid)
        cancel_ev = j["cancel"] if j else None
        filename_stored = str(j.get("filename") or "upload.txt") if j else "upload.txt"
    if cancel_ev is not None and cancel_ev.is_set():
        _update(jid, status="cancelled")
        return

    _update(jid, status="parsing")
    path = Path(filename_stored)
    try:
        messages, platform = parse_chat_file(path, raw)
    except Exception as e:
        logger.exception("import job parse failed")
        _update(jid, status="error", error=str(e))
        return

    if not messages:
        _update(jid, status="error", error="未能解析出消息")
        return

    texts = [m.text for m in messages]
    metas = [
        {
            "sender": m.sender or "",
            "platform": m.platform,
            "ts": m.ts.isoformat() if m.ts else "",
            "thread": m.thread or "",
        }
        for m in messages
    ]
    total = len(texts)
    _update(
        jid,
        parsed_total=total,
        platform=platform,
        embedded_total=total,
        embedded_done=0,
    )

    if cancel_ev is not None and cancel_ev.is_set():
        _update(jid, status="cancelled")
        return

    def on_prog(done: int, tot: int) -> None:
        _update(jid, embedded_done=done, embedded_total=tot, status="embedding")

    user = load_user_settings(settings.settings_path)
    store = MessageStore(settings, user)
    try:
        added, skipped = store.add_messages(
            texts,
            metas,
            source=platform,
            dedupe=dedupe,
            embed_chunk_size=EMBED_CHUNK,
            on_embed_progress=on_prog,
            cancel_event=cancel_ev,
        )
    except Exception as e:
        logger.exception("import job embed failed")
        _update(jid, status="error", error=str(e))
        return

    if cancel_ev is not None and cancel_ev.is_set():
        _update(
            jid,
            status="cancelled",
            imported=added,
            skipped_duplicates=skipped,
        )
        return

    _update(jid, status="profile")
    try:
        prev = load_profile(settings.profile_path)
        fresh = build_profile_from_store(store, previous=prev)
        merged = merge_profile_json(prev, fresh) if prev else fresh
        merged.updated_at = datetime.now(UTC).isoformat()
        save_profile(settings.profile_path, merged)
    except Exception:
        logger.exception("import job profile refresh failed")

    _update(
        jid,
        status="done",
        imported=added,
        skipped_duplicates=skipped,
        embedded_done=total,
        embedded_total=total,
    )
