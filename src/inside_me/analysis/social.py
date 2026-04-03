from __future__ import annotations

from collections import Counter
from datetime import datetime
from typing import Any


def _parse_ts(meta: dict[str, Any]) -> datetime | None:
    raw = str((meta or {}).get("ts") or "").strip()
    if not raw:
        return None
    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(raw)
    except ValueError:
        pass
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"):
        try:
            return datetime.strptime(raw, fmt)
        except ValueError:
            continue
    return None


def _norm_pair(a: str, b: str) -> tuple[str, str]:
    return (a, b) if a <= b else (b, a)


def compute_social_stats(
    rows: list[dict[str, Any]],
    *,
    max_rows: int = 8000,
) -> dict[str, Any]:
    """
    基于消息元数据中的 sender、ts：
    - top_senders：发送者出现条数
    - adjacent_pairs：按时间排序后，相邻两条且发送者不同则计一次无向边（粗略反映对话来回）
    """
    slice_rows = rows[:max_rows]
    ordered = sorted(
        enumerate(slice_rows),
        key=lambda iv: (_parse_ts((iv[1].get("metadata") or {})) or datetime.max, iv[0]),
    )

    sender_counts: Counter[str] = Counter()
    pair_counts: Counter[tuple[str, str]] = Counter()

    prev_sender: str | None = None
    for _, row in ordered:
        meta = row.get("metadata") or {}
        s = str(meta.get("sender") or "").strip() or "（未标注发送者）"
        sender_counts[s] += 1
        if prev_sender is not None and prev_sender != s:
            x, y = _norm_pair(prev_sender, s)
            pair_counts[(x, y)] += 1
        prev_sender = s

    top_senders = [{"name": n, "count": c} for n, c in sender_counts.most_common(25)]
    top_pairs = [
        {"a": a, "b": b, "count": c}
        for (a, b), c in pair_counts.most_common(30)
        if a != b
    ]

    return {
        "sample_size": len(slice_rows),
        "top_senders": top_senders,
        "adjacent_pairs": top_pairs,
    }
