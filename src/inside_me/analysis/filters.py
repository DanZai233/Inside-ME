from __future__ import annotations

from datetime import datetime
from typing import Any

from dateutil import parser as date_parser

from inside_me.sender_aliases import sender_matches_self


def _parse_ts_bound(raw: str | None, *, end_of_day: bool) -> datetime | None:
    if not raw or not str(raw).strip():
        return None
    s = str(raw).strip()
    try:
        dt = date_parser.parse(s)
    except (ValueError, TypeError, OverflowError):
        return None
    date_only = len(s) <= 10 and "T" not in s.upper() and " " not in s
    if date_only:
        if end_of_day:
            return dt.replace(hour=23, minute=59, second=59, microsecond=999999)
        return dt.replace(hour=0, minute=0, second=0, microsecond=0)
    return dt


def _row_meta_dt(meta: Any) -> datetime | None:
    if not isinstance(meta, dict):
        return None
    ts = str(meta.get("ts") or "").strip()
    if not ts:
        return None
    try:
        return date_parser.parse(ts)
    except (ValueError, TypeError, OverflowError):
        return None


def _meta_thread(meta: Any) -> str:
    if not isinstance(meta, dict):
        return ""
    return str(meta.get("thread") or "").strip()


def filter_message_rows(
    rows: list[dict[str, Any]],
    *,
    platform: str | None = None,
    ts_from: str | None = None,
    ts_to: str | None = None,
    thread: str | None = None,
    sender_mode: str = "any",
    self_aliases: list[str] | None = None,
) -> list[dict[str, Any]]:
    """与 browse_memory 语义一致的内存过滤（用于仪表盘 / 分析在 capped 样本上）。"""
    plat = platform.strip() if platform and platform.strip() else None
    th = thread.strip() if thread and thread.strip() else None
    t0 = _parse_ts_bound(ts_from, end_of_day=False) if ts_from else None
    t1 = _parse_ts_bound(ts_to, end_of_day=True) if ts_to else None
    ts_active = t0 is not None or t1 is not None
    aliases_eff = [a.strip() for a in (self_aliases or []) if a.strip()]
    sender_active = sender_mode in ("self_only", "exclude_self") and bool(aliases_eff)

    out: list[dict[str, Any]] = []
    for row in rows:
        meta = row.get("metadata") or {}
        if plat:
            p = str(meta.get("platform") or "").strip()
            if p != plat:
                continue
        if th is not None:
            if _meta_thread(meta) != th:
                continue
        if ts_active:
            dt = _row_meta_dt(meta)
            if dt is None:
                continue
            if t0 is not None and dt < t0:
                continue
            if t1 is not None and dt > t1:
                continue
        if sender_active:
            s = str(meta.get("sender") or "").strip()
            is_sf = sender_matches_self(s, aliases_eff) if s else False
            if sender_mode == "self_only" and not is_sf:
                continue
            if sender_mode == "exclude_self" and is_sf:
                continue
        out.append(row)
    return out


def distinct_threads(rows: list[dict[str, Any]], *, max_items: int = 80) -> list[str]:
    seen: set[str] = set()
    for row in rows:
        t = _meta_thread(row.get("metadata") or {})
        if t:
            seen.add(t)
    return sorted(seen)[:max_items]
