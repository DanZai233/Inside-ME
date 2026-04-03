from __future__ import annotations

import json
from pathlib import Path

from inside_me.api.schemas import UserSettings


def load_user_settings(path: Path) -> UserSettings:
    if not path.exists():
        return UserSettings()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return UserSettings.model_validate(data)
    except (json.JSONDecodeError, ValueError):
        return UserSettings()


def save_user_settings(path: Path, u: UserSettings) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(u.model_dump_json(indent=2), encoding="utf-8")


def remote_embedding_enabled(u: UserSettings) -> bool:
    if not u.use_remote_embedding or not (u.embedding_model or "").strip():
        return False
    key = (u.api_key or "").strip()
    if not key or key.startswith("****") or "…" in key:
        return False
    return True


def use_ark_multimodal_embeddings(u: UserSettings) -> bool:
    """方舟 vision / 多模态向量模型走 /embeddings/multimodal，input 为 [{type,text}, …]。"""
    if u.embedding_ark_multimodal:
        return True
    m = (u.embedding_model or "").lower()
    return "embedding-vision" in m or m.startswith("doubao-embedding-vision")
