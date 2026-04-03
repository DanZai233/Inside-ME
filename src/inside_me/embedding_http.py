from __future__ import annotations

import logging
from typing import Any

import httpx
import numpy as np
from chromadb.api.types import Documents, Embeddings, EmbeddingFunction, Space

from inside_me.openai_compat import (
    ark_multimodal_embeddings_url,
    httpx_client_kwargs,
    openai_compatible_embeddings_url,
)

logger = logging.getLogger(__name__)


def _extract_first_embedding(data: dict[str, Any]) -> list[float]:
    """兼容 OpenAI 式 data: [{embedding}] 与方舟 multimodal 式 data: {embedding: [...]}。"""
    payload = data.get("data")
    if isinstance(payload, dict):
        vec = payload.get("embedding")
        if vec is not None:
            return list(vec)
    if isinstance(payload, list) and payload:
        first = payload[0]
        if isinstance(first, dict):
            vec = first.get("embedding")
            if vec is not None:
                return list(vec)
    emb = data.get("embedding")
    if emb is not None:
        return list(emb)
    raise ValueError(f"无法解析 embedding 响应: {str(data)[:400]}")


class HttpOpenAICompatibleEmbeddingFunction(EmbeddingFunction[Documents]):
    """OpenAI /v1/embeddings、方舟 /api/v3/embeddings，或方舟 /api/v3/embeddings/multimodal（vision 文本）。"""

    def __init__(
        self,
        *,
        api_base_url: str,
        api_key: str,
        model: str,
        multimodal: bool = False,
    ) -> None:
        self._api_key = api_key
        self._model = model.strip()
        self._multimodal = multimodal
        if multimodal:
            self._url = ark_multimodal_embeddings_url(api_base_url)
        else:
            self._url = openai_compatible_embeddings_url(api_base_url)

    def __call__(self, input: Documents) -> Embeddings:
        if not input:
            return []
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }
        kwargs = httpx_client_kwargs(120.0)
        with httpx.Client(**kwargs) as client:
            if self._multimodal:
                return self._embed_multimodal_text_only(client, headers, list(input))
            return self._embed_openai_batch(client, headers, list(input))

    def _embed_openai_batch(
        self, client: httpx.Client, headers: dict[str, str], texts: list[str]
    ) -> Embeddings:
        out: Embeddings = []
        batch_size = 24
        for i in range(0, len(texts), batch_size):
            chunk = texts[i : i + batch_size]
            r = client.post(
                self._url,
                headers=headers,
                json={"model": self._model, "input": chunk},
            )
            self._raise_for_status(r)
            data = r.json()
            rows = sorted(data.get("data") or [], key=lambda x: int(x.get("index", 0)))
            for row in rows:
                vec = row.get("embedding")
                if vec is None:
                    raise ValueError("embedding API 响应缺少 embedding 字段")
                out.append(np.array(vec, dtype=np.float32))
            if len(rows) != len(chunk):
                raise ValueError(
                    f"embedding 条数不匹配：请求 {len(chunk)} 条，返回 {len(rows)} 条"
                )
        return out

    def _embed_multimodal_text_only(
        self, client: httpx.Client, headers: dict[str, str], texts: list[str]
    ) -> Embeddings:
        """方舟 multimodal 接口：每条文本单独请求，input 为 [{\"type\":\"text\",\"text\":\"…\"}]。"""
        out: Embeddings = []
        for s in texts:
            text = s if s.strip() else " "
            r = client.post(
                self._url,
                headers=headers,
                json={
                    "model": self._model,
                    "input": [{"type": "text", "text": text}],
                },
            )
            self._raise_for_status(r)
            data = r.json()
            vec = _extract_first_embedding(data)
            out.append(np.array(vec, dtype=np.float32))
        return out

    @staticmethod
    def _raise_for_status(r: httpx.Response) -> None:
        try:
            r.raise_for_status()
        except httpx.HTTPStatusError:
            logger.exception("Embedding HTTP %s: %s", r.status_code, r.text[:500])
            raise

    def default_space(self) -> Space:
        return "cosine"

    @staticmethod
    def name() -> str:
        return "inside_me_http_openai_compat"
