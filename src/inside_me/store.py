from __future__ import annotations

import logging
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

    def add_messages(
        self,
        texts: list[str],
        metadatas: list[dict[str, Any]],
        source: str,
    ) -> int:
        if not texts:
            return 0
        ids = [f"{source}-{uuid.uuid4().hex}" for _ in texts]
        self._col.add(ids=ids, documents=texts, metadatas=metadatas)
        return len(ids)

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
