from __future__ import annotations

import hashlib
import logging
import re
import threading
import uuid
from collections.abc import Callable
from datetime import datetime
from pathlib import Path
from typing import Any

import chromadb
from chromadb.utils import embedding_functions
from dateutil import parser as date_parser

from inside_me.api.schemas import UserSettings
from inside_me.config import Settings
from inside_me.embedding_http import HttpOpenAICompatibleEmbeddingFunction
from inside_me.prefs import (
    load_user_settings,
    remote_embedding_enabled,
    use_ark_multimodal_embeddings,
)
from inside_me.sender_aliases import sender_matches_self

logger = logging.getLogger(__name__)


def _content_sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _where_document_ci_substring(q: str) -> dict[str, Any] | None:
    """Chroma where_document：不区分大小写的正文子串（字面量，非用户正则）。"""
    s = q.strip()
    if not s:
        return None
    return {"$regex": f"(?i){re.escape(s)}"}


_BROWSE_TS_SCAN_CAP = 5000


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


def _meta_thread_val(meta: Any) -> str:
    if not isinstance(meta, dict):
        return ""
    return str(meta.get("thread") or "").strip()


def _meta_tags_str(meta: Any) -> str:
    if not isinstance(meta, dict):
        return ""
    return str(meta.get("tags") or "")


def _meta_passes_ts_bounds(
    meta: Any,
    t0: datetime | None,
    t1: datetime | None,
) -> bool:
    """元数据 ts 是否在 [t0, t1] 内；无时间筛选时恒为 True。有筛选但条目无有效 ts 则剔除。"""
    if t0 is None and t1 is None:
        return True
    dt = _row_meta_dt(meta)
    if dt is None:
        return False
    if t0 is not None and dt < t0:
        return False
    if t1 is not None and dt > t1:
        return False
    return True


class MessageStore:
    def __init__(self, settings: Settings, user: UserSettings | None = None) -> None:
        settings.data_dir.mkdir(parents=True, exist_ok=True)
        self._user = user if user is not None else load_user_settings(settings.settings_path)
        chroma_dir = _chroma_dir(settings, self._user)
        self._client = chromadb.PersistentClient(path=str(chroma_dir))
        self._ef = _make_embedding_function(self._user)
        self._col = self._client.get_or_create_collection(
            name="messages",
            embedding_function=self._ef,
            metadata={"description": "Chat message chunks for RAG"},
        )

    def existing_content_hashes(self, max_scan: int = 80_000) -> set[str]:
        """用于导入去重；仅扫描已有条目的 content_sha256 元数据。"""
        n = min(self._col.count(), max_scan)
        if n <= 0:
            return set()
        try:
            raw = self._col.get(limit=n, include=["metadatas"])
        except Exception:
            logger.exception("existing_content_hashes get failed")
            return set()
        metas = raw.get("metadatas") or []
        out: set[str] = set()
        for m in metas:
            if not isinstance(m, dict):
                continue
            h = m.get("content_sha256")
            if isinstance(h, str) and len(h) == 64:
                out.add(h)
        return out

    def add_messages(
        self,
        texts: list[str],
        metadatas: list[dict[str, Any]],
        source: str,
        *,
        dedupe: bool = False,
        embed_chunk_size: int | None = None,
        on_embed_progress: Callable[[int, int], None] | None = None,
        cancel_event: threading.Event | None = None,
    ) -> tuple[int, int]:
        """写入向量库。返回 (新增条数, 跳过条数)。

        dedupe=True 时按 content_sha256 跳过库内与当批重复。
        embed_chunk_size 非空则分批 collection.add；cancel_event 在批间检查。
        """
        if not texts:
            return 0, 0
        existing: set[str] = self.existing_content_hashes() if dedupe else set()
        add_texts: list[str] = []
        add_metas: list[dict[str, Any]] = []
        add_ids: list[str] = []
        skipped = 0
        batch_seen: set[str] = set()
        for text, meta in zip(texts, metadatas, strict=True):
            h = _content_sha256(text)
            row_meta = {**meta, "content_sha256": h}
            if dedupe and (h in existing or h in batch_seen):
                skipped += 1
                continue
            batch_seen.add(h)
            existing.add(h)
            add_texts.append(text)
            add_metas.append(row_meta)
            add_ids.append(f"{source}-{uuid.uuid4().hex}")
        if not add_texts:
            return 0, skipped
        imported = self._flush_add_buffer(
            add_ids,
            add_texts,
            add_metas,
            embed_chunk_size=embed_chunk_size,
            on_embed_progress=on_embed_progress,
            cancel_event=cancel_event,
        )
        return imported, skipped

    def _flush_add_buffer(
        self,
        add_ids: list[str],
        add_texts: list[str],
        add_metas: list[dict[str, Any]],
        *,
        embed_chunk_size: int | None,
        on_embed_progress: Callable[[int, int], None] | None,
        cancel_event: threading.Event | None,
    ) -> int:
        """返回实际写入条数（取消时为已写入条数）。"""
        total_n = len(add_ids)
        chunk = embed_chunk_size if embed_chunk_size and embed_chunk_size > 0 else total_n
        if chunk >= total_n:
            if cancel_event is not None and cancel_event.is_set():
                return 0
            self._col.add(ids=add_ids, documents=add_texts, metadatas=add_metas)
            if on_embed_progress is not None:
                on_embed_progress(total_n, total_n)
            return total_n
        done = 0
        for start in range(0, total_n, chunk):
            if cancel_event is not None and cancel_event.is_set():
                return done
            end = min(start + chunk, total_n)
            self._col.add(
                ids=add_ids[start:end],
                documents=add_texts[start:end],
                metadatas=add_metas[start:end],
            )
            done = end
            if on_embed_progress is not None:
                on_embed_progress(done, total_n)
        return total_n

    def delete_by_ids(self, ids: list[str]) -> int:
        if not ids:
            return 0
        try:
            self._col.delete(ids=ids)
        except Exception:
            logger.exception("delete_by_ids failed")
            return 0
        return len(ids)

    def update_message(
        self,
        mid: str,
        *,
        document: str | None = None,
        sender: str | None = None,
        platform: str | None = None,
        ts: str | None = None,
        thread: str | None = None,
        tags: str | None = None,
    ) -> bool:
        """按 id 更新一条记忆的正文与/或元数据；正文变更会重算 content_sha256 与向量。"""
        if not (mid or "").strip():
            return False
        if all(
            x is None
            for x in (document, sender, platform, ts, thread, tags)
        ):
            return False
        try:
            raw = self._col.get(ids=[mid.strip()], include=["documents", "metadatas"])
        except Exception:
            logger.exception("update_message get failed")
            return False
        ids = raw.get("ids") or []
        if not ids:
            return False
        docs = raw.get("documents") or []
        metas = raw.get("metadatas") or []
        old_doc = docs[0] if docs else ""
        if not isinstance(old_doc, str):
            old_doc = str(old_doc)
        old_meta = dict(metas[0]) if metas and isinstance(metas[0], dict) else {}
        new_doc = old_doc if document is None else document
        merged: dict[str, Any] = {**old_meta}
        if sender is not None:
            merged["sender"] = sender
        if platform is not None:
            merged["platform"] = platform
        if ts is not None:
            merged["ts"] = ts
        if thread is not None:
            merged["thread"] = thread
        if tags is not None:
            merged["tags"] = tags
        try:
            self._col.update(ids=[mid.strip()], documents=[new_doc], metadatas=[merged])
        except Exception:
            logger.exception("update_message update failed")
            return False
        return True

    def browse_memory(
        self,
        *,
        limit: int = 50,
        offset: int = 0,
        platform: str | None = None,
        q: str | None = None,
        ts_from: str | None = None,
        ts_to: str | None = None,
        sender_mode: str = "any",
        self_aliases: list[str] | None = None,
        thread: str | None = None,
        tag: str | None = None,
    ) -> tuple[list[dict[str, Any]], dict[str, Any]]:
        """返回 (条目列表, meta)。时间 / 发送者 / 会话 / 标签筛选时在最多 _BROWSE_TS_SCAN_CAP 条内过滤后排序分页。"""
        cap = min(max(limit, 1), 500)
        off = max(offset, 0)
        qstrip = (q or "").strip()
        wd = _where_document_ci_substring(qstrip) if qstrip else None
        plat = platform.strip() if platform and platform.strip() else None
        thread_f = thread.strip() if thread and thread.strip() else None
        tag_f = tag.strip() if tag and tag.strip() else None
        t0 = _parse_ts_bound(ts_from, end_of_day=False) if ts_from else None
        t1 = _parse_ts_bound(ts_to, end_of_day=True) if ts_to else None
        ts_active = t0 is not None or t1 is not None
        aliases_eff = [a.strip() for a in (self_aliases or []) if a.strip()]
        sender_active = sender_mode in ("self_only", "exclude_self") and bool(aliases_eff)
        wide_scan = ts_active or sender_active or thread_f is not None or tag_f is not None

        kw: dict[str, Any] = {
            "limit": _BROWSE_TS_SCAN_CAP if wide_scan else cap,
            "offset": 0 if wide_scan else off,
            "include": ["documents", "metadatas"],
        }
        if plat:
            kw["where"] = {"platform": {"$eq": plat}}
        if wd:
            kw["where_document"] = wd
        try:
            raw = self._col.get(**kw)
        except Exception:
            logger.exception("browse_memory get failed")
            return [], {"scan_capped": False, "total_matching": None}

        ids = raw.get("ids") or []
        docs = raw.get("documents") or []
        metas = raw.get("metadatas") or []
        rows: list[dict[str, Any]] = []
        for i in range(len(ids)):
            doc = docs[i] if i < len(docs) else ""
            rows.append(
                {
                    "id": ids[i],
                    "document": doc,
                    "metadata": metas[i] if i < len(metas) else {},
                }
            )

        scan_capped = wide_scan and len(ids) >= _BROWSE_TS_SCAN_CAP

        if ts_active or sender_active or thread_f is not None or tag_f is not None:
            filtered: list[dict[str, Any]] = []
            for row in rows:
                meta = row.get("metadata") or {}
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
                if thread_f is not None:
                    if _meta_thread_val(meta) != thread_f:
                        continue
                if tag_f is not None:
                    if tag_f.lower() not in _meta_tags_str(meta).lower():
                        continue
                filtered.append(row)
            filtered.sort(
                key=lambda r: _row_meta_dt(r.get("metadata")) or datetime.min,
                reverse=True,
            )
            total = len(filtered)
            page = filtered[off : off + cap]
            return page, {
                "scan_capped": scan_capped,
                "total_matching": total,
            }

        return rows, {"scan_capped": False, "total_matching": None}

    def query(
        self,
        text: str,
        n: int = 8,
        *,
        platform: str | None = None,
        ts_from: str | None = None,
        ts_to: str | None = None,
        sender_mode: str = "any",
        self_aliases: list[str] | None = None,
        thread: str | None = None,
    ) -> list[dict[str, Any]]:
        if not text.strip():
            return []
        t0 = _parse_ts_bound(ts_from, end_of_day=False) if ts_from else None
        t1 = _parse_ts_bound(ts_to, end_of_day=True) if ts_to else None
        ts_active = t0 is not None or t1 is not None
        aliases_eff = [a.strip() for a in (self_aliases or []) if a.strip()]
        sender_active = sender_mode in ("self_only", "exclude_self") and bool(aliases_eff)
        plat = platform.strip() if platform and platform.strip() else None
        thread_f = thread.strip() if thread and thread.strip() else None
        where: dict[str, Any] | None = {"platform": {"$eq": plat}} if plat else None
        n_fetch = n
        if ts_active or sender_active or thread_f is not None:
            n_fetch = min(200, max(n * 12, 40))
        qkw: dict[str, Any] = {"query_texts": [text], "n_results": n_fetch}
        if where is not None:
            qkw["where"] = where
        try:
            res = self._col.query(**qkw)
        except Exception:
            logger.exception("向量检索失败，已降级为空 RAG 上下文（可改用云端嵌入或检查网络/代理）")
            return []
        out: list[dict[str, Any]] = []
        ids = res.get("ids") or [[]]
        docs = res.get("documents") or [[]]
        metas = res.get("metadatas") or [[]]
        dists = res.get("distances") or [[]]
        for i in range(len(ids[0])):
            meta = metas[0][i] if metas and metas[0] else {}
            if not _meta_passes_ts_bounds(meta, t0, t1):
                continue
            if thread_f is not None and _meta_thread_val(meta) != thread_f:
                continue
            out.append(
                {
                    "id": ids[0][i],
                    "document": docs[0][i],
                    "metadata": meta if isinstance(meta, dict) else {},
                    "distance": dists[0][i] if dists and dists[0] else None,
                }
            )
        if sender_active:
            filtered: list[dict[str, Any]] = []
            for h in out:
                meta = h.get("metadata") or {}
                s = str(meta.get("sender") or "").strip()
                is_sf = sender_matches_self(s, aliases_eff) if s else False
                if sender_mode == "self_only" and not is_sf:
                    continue
                if sender_mode == "exclude_self" and is_sf:
                    continue
                filtered.append(h)
            out = filtered
        return out[:n]

    def count(self) -> int:
        return self._col.count()

    def peek_sample(self, limit: int = 200) -> list[dict[str, Any]]:
        raw = self._col.get(limit=limit, include=["documents", "metadatas"])
        docs = raw.get("documents") or []
        metas = raw.get("metadatas") or []
        return [{"text": docs[i], "metadata": metas[i] if i < len(metas) else {}} for i in range(len(docs))]

    def list_messages_for_stats(self, limit: int = 8000) -> list[dict[str, Any]]:
        """拉取一批消息（含 id、元数据），用于发送者/相邻对话等本地统计与分析。"""
        raw = self._col.get(limit=limit, include=["documents", "metadatas"])
        ids = raw.get("ids") or []
        docs = raw.get("documents") or []
        metas = raw.get("metadatas") or []
        return [
            {
                "id": ids[i] if i < len(ids) else "",
                "text": docs[i],
                "metadata": metas[i] if i < len(metas) else {},
            }
            for i in range(len(docs))
        ]


def _chroma_dir(settings: Settings, user: UserSettings) -> Path:
    if remote_embedding_enabled(user):
        return settings.data_dir / "chroma_remote"
    return settings.chroma_path


def _make_embedding_function(user: UserSettings):
    if remote_embedding_enabled(user):
        return HttpOpenAICompatibleEmbeddingFunction(
            api_base_url=user.api_base_url,
            api_key=user.api_key.strip(),
            model=user.embedding_model.strip(),
            multimodal=use_ark_multimodal_embeddings(user),
        )
    return embedding_functions.DefaultEmbeddingFunction()
