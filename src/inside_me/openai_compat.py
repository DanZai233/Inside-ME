from __future__ import annotations

import os


def openai_compatible_chat_completions_url(base_url: str) -> str:
    """OpenAI: …/v1/chat/completions；火山方舟等：…/api/v3/chat/completions。"""
    b = base_url.rstrip("/")
    if b.endswith("/api/v3"):
        return f"{b}/chat/completions"
    return f"{b}/v1/chat/completions"


def openai_compatible_embeddings_url(base_url: str) -> str:
    """OpenAI: …/v1/embeddings；火山方舟等：…/api/v3/embeddings（纯文本）。"""
    b = base_url.rstrip("/")
    if b.endswith("/api/v3"):
        return f"{b}/embeddings"
    return f"{b}/v1/embeddings"


def ark_multimodal_embeddings_url(base_url: str) -> str:
    """火山方舟多模态向量：…/api/v3/embeddings/multimodal（如 doubao-embedding-vision-*）。"""
    b = base_url.rstrip("/")
    if not b.endswith("/api/v3"):
        raise ValueError("多模态向量 API 仅适用于以 /api/v3 结尾的方舟 Base URL")
    return f"{b}/embeddings/multimodal"


def httpx_client_kwargs(timeout: float = 120.0) -> dict:
    """若系统代理导致 TLS 异常，可设 INSIDE_ME_HTTP_TRUST_ENV=0 禁用环境代理。"""
    v = (os.getenv("INSIDE_ME_HTTP_TRUST_ENV") or "").strip().lower()
    if v in ("0", "false", "no", "off"):
        return {"timeout": timeout, "trust_env": False}
    return {"timeout": timeout, "trust_env": True}
