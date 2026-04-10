from __future__ import annotations

import json
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field, field_validator

from inside_me.store import MessageStore


_CN_STOP = frozenset(
    "的了吗呢吧啊哦嗯么什怎哪为与和或在是了就都也还又及很到对从我你他她它们这那有要会能可以一个不是人时后来说去里多过上下自己东西么".split()
)


def _tokenize(text: str) -> list[str]:
    parts = re.findall(r"[\u4e00-\u9fff]{2,}|[a-zA-Z]{3,}", text.lower())
    return [p for p in parts if p not in _CN_STOP and len(p) >= 2]


class ProfileState(BaseModel):
    version: int = 1
    updated_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    message_count: int = 0
    platforms: dict[str, int] = Field(default_factory=dict)
    top_terms: list[tuple[str, int]] = Field(default_factory=list)
    avg_message_len: float = 0.0
    persona_summary: str = ""
    values_notes: str = ""
    fear_desire_notes: str = ""

    @field_validator("top_terms", mode="before")
    @classmethod
    def _coerce_top_terms(cls, v: object) -> list[tuple[str, int]]:
        if not v:
            return []
        out: list[tuple[str, int]] = []
        for item in v:  # type: ignore[assignment]
            if isinstance(item, (list, tuple)) and len(item) == 2:
                out.append((str(item[0]), int(item[1])))
        return out

    def to_public_dict(self) -> dict[str, Any]:
        return self.model_dump()


def build_profile_from_rows(
    rows: list[dict[str, Any]],
    *,
    previous: ProfileState | None = None,
    total_message_count: int | None = None,
) -> ProfileState:
    """从已筛选的消息行列表构建画像统计（词频、平台分布等）；笔记类字段继承 previous。"""
    if not rows:
        base = previous or ProfileState()
        base.message_count = total_message_count if total_message_count is not None else 0
        base.updated_at = datetime.now(timezone.utc).isoformat()
        return base

    platforms: Counter[str] = Counter()
    lengths: list[int] = []
    term_counter: Counter[str] = Counter()
    for row in rows:
        meta = row.get("metadata") or {}
        plat = str(meta.get("platform") or "unknown")
        platforms[plat] += 1
        t = row.get("text") or ""
        lengths.append(len(t))
        term_counter.update(_tokenize(t))

    top = term_counter.most_common(40)
    avg_len = sum(lengths) / len(lengths) if lengths else 0.0
    mc = total_message_count if total_message_count is not None else len(rows)
    state = ProfileState(
        message_count=mc,
        platforms=dict(platforms),
        top_terms=top[:20],
        avg_message_len=round(avg_len, 2),
        persona_summary=(previous.persona_summary if previous else ""),
        values_notes=(previous.values_notes if previous else ""),
        fear_desire_notes=(previous.fear_desire_notes if previous else ""),
    )
    if previous:
        if not state.persona_summary:
            state.persona_summary = previous.persona_summary
        if not state.values_notes:
            state.values_notes = previous.values_notes
        if not state.fear_desire_notes:
            state.fear_desire_notes = previous.fear_desire_notes
    state.updated_at = datetime.now(timezone.utc).isoformat()
    return state


def build_profile_from_store(store: MessageStore, previous: ProfileState | None = None) -> ProfileState:
    sample = store.peek_sample(limit=5000)
    if not sample:
        base = previous or ProfileState()
        base.message_count = store.count()
        base.updated_at = datetime.now(timezone.utc).isoformat()
        return base

    platforms: Counter[str] = Counter()
    lengths: list[int] = []
    term_counter: Counter[str] = Counter()
    for row in sample:
        meta = row.get("metadata") or {}
        plat = str(meta.get("platform") or "unknown")
        platforms[plat] += 1
        t = row.get("text") or ""
        lengths.append(len(t))
        term_counter.update(_tokenize(t))

    top = term_counter.most_common(40)
    avg_len = sum(lengths) / len(lengths) if lengths else 0.0
    state = ProfileState(
        message_count=store.count(),
        platforms=dict(platforms),
        top_terms=top[:20],
        avg_message_len=round(avg_len, 2),
        persona_summary=(previous.persona_summary if previous else ""),
        values_notes=(previous.values_notes if previous else ""),
        fear_desire_notes=(previous.fear_desire_notes if previous else ""),
    )
    if previous and not state.persona_summary:
        state.persona_summary = previous.persona_summary
    return state


def load_profile(path: Path) -> ProfileState | None:
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return ProfileState.model_validate(data)
    except (json.JSONDecodeError, ValueError):
        return None


def save_profile(path: Path, state: ProfileState) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state.model_dump(), ensure_ascii=False, indent=2), encoding="utf-8")


def merge_profile_json(old: ProfileState, new: ProfileState) -> ProfileState:
    merged = new.model_copy()
    merged.platforms = dict(Counter(old.platforms) + Counter(new.platforms))
    old_terms = Counter({k: v for k, v in old.top_terms})
    old_terms.update({k: v for k, v in new.top_terms})
    merged.top_terms = old_terms.most_common(20)
    merged.persona_summary = new.persona_summary or old.persona_summary
    merged.values_notes = new.values_notes or old.values_notes
    merged.fear_desire_notes = new.fear_desire_notes or old.fear_desire_notes
    return merged
