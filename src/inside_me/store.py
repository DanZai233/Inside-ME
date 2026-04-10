from __future__ import annotations

import hashlib
import logging
import re
import uuid
from pathlib import Path
from typing import Any

import chromadb
from chromadb.utils import embedding_functions

from inside_me.api.schemas import UserSettings
from inside_me.config import Settings
from inside_me.embedding_http import HttpOpenAICompatibleEmbeddingFunction
from inside_me.prefs import (
    load_user_settings,
    remote_embedding_enabled,
    use_ark_multimodal_embeddings,
)

logger = logging.getLogger(__name__)


def _content_sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _where_document_ci_substring(q: str) -> dict[str, Any] | None:
    """Chroma where_document：不区分大小写的正文子串（字面量，非用户正则）。"""
    s = q.strip()
    if not s:
        return None
    return {"$regex": f"(?i){re.escape(s)}"}


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
    ) -> tuple[int, int]:
        """写入向量库。返回 (新增条数, 跳过条数)。dedupe=True 时跳过与库内 content_sha256 相同的内容。"""
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
        self._col.add(ids=add_ids, documents=add_texts, metadatas=add_metas)
        return len(add_ids), skipped

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
    ) -> bool:
        """按 id 更新一条记忆的正文与/或元数据；正文变更会重算 content_sha256 与向量。"""
        if not (mid or "").strip():
            return False
        if document is None and sender is None and platform is None and ts is None:
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
        merged["content_sha256"] = _content_sha256(new_doc)
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
    ) -> list[dict[str, Any]]:
        cap = min(max(limit, 1), 500)
        kw: dict[str, Any] = {
            "limit": cap,
            "offset": max(offset, 0),
            "include": ["documents", "metadatas"],
        }
        if platform and platform.strip():
            kw["where"] = {"platform": {"$eq": platform.strip()}}
        qstrip = (q or "").strip()
        wd = _where_document_ci_substring(qstrip) if qstrip else None
        if wd:
            kw["where_document"] = wd
        try:
            raw = self._col.get(**kw)
        except Exception:
            logger.exception("browse_memory get failed")
            return []
        ids = raw.get("ids") or []
        docs = raw.get("documents") or []
        metas = raw.get("metadatas") or []
        out: list[dict[str, Any]] = []
        for i in range(len(ids)):
            doc = docs[i] if i < len(docs) else ""
            out.append(
                {
                    "id": ids[i],
                    "document": doc,
                    "metadata": metas[i] if i < len(metas) else {},
                }
            )
        return out

    def query(self, text: str, n: int = 8) -> list[dict[str, Any]]:
        if not text.strip():
            return []
        try:
            res = self._col.query(query_texts=[text], n_results=n)
        except Exception:
            logger.exception("向量检索失败，已降级为空 RAG 上下文（可改用云端嵌入或检查网络/代理）")
            return []
        out: list[dict[str, Any]] = []
        ids = res.get("ids") or [[]]
        docs = res.get("documents") or [[]]
        metas = res.get("metadatas") or [[]]
        dists = res.get("distances") or [[]]
        for i in range(len(ids[0])):
            out.append(
                {
                    "id": ids[0][i],
                    "document": docs[0][i],
                    "metadata": metas[0][i] if metas[0] else {},
                    "distance": dists[0][i] if dists and dists[0] else None,
                }
            )
        return out

    def count(self) -> int:
        return self._col.count()

    def peek_sample(self, limit: int = 200) -> list[dict[str, Any]]:
        raw = self._col.get(limit=limit, include=["documents", "metadatas"])
        docs = raw.get("documents") or []
        metas = raw.get("metadatas") or []
        return [{"text": docs[i], "metadata": metas[i] if i < len(metas) else {}} for i in range(len(docs))]

    def list_messages_for_stats(self, limit: int = 8000) -> list[dict[str, Any]]:
        """拉取一批消息（含元数据），用于发送者/相邻对话等本地统计。"""
        raw = self._col.get(limit=limit, include=["documents", "metadatas"])
        docs = raw.get("documents") or []
        metas = raw.get("metadatas") or []
        return [{"text": docs[i], "metadata": metas[i] if i < len(metas) else {}} for i in range(len(docs))]


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
