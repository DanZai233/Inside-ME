from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator


class ChatPromptTemplate(BaseModel):
    """用户自定义系统提示片段（对话页可一键插入）。"""

    name: str = Field(default="", max_length=80)
    body: str = Field(default="", max_length=8000)


class UserSettings(BaseModel):
    api_base_url: str = Field(default="https://api.openai.com")
    api_key: str = Field(default="")
    model: str = Field(default="gpt-4o-mini")
    # 使用与对话相同的 Base URL + API Key，走 OpenAI 兼容 /v1/embeddings 或火山 /api/v3/embeddings
    use_remote_embedding: bool = False
    embedding_model: str = Field(default="", description="如火山方舟的 Embedding 模型名或 Endpoint ID")
    # 强制走方舟 /embeddings/multimodal；留 false 时若模型名含 embedding-vision 会自动启用
    embedding_ark_multimodal: bool = False
    # 与导入元数据 sender 比对（大小写不敏感；支持 QQ「昵称(qq号)」去括号匹配）
    self_sender_aliases: list[str] = Field(
        default_factory=list,
        max_length=32,
        description="导出记录里「我」的昵称/帐号，用于统计与 RAG 筛选",
    )
    chat_prompt_templates: list[ChatPromptTemplate] = Field(
        default_factory=list,
        description="命名系统补充片段，对话侧选用",
    )
    chat_quick_prompts: list[str] = Field(
        default_factory=list,
        description="快捷问句（插入输入框）",
    )

    @field_validator("self_sender_aliases", mode="before")
    @classmethod
    def _coerce_aliases(cls, v: object) -> list[str]:
        if v is None:
            return []
        if isinstance(v, str):
            parts = re.split(r"[\n,，;；]+", v)
            return [p.strip()[:200] for p in parts if p.strip()][:32]
        if isinstance(v, list):
            out: list[str] = []
            for x in v:
                s = str(x).strip()[:200]
                if s:
                    out.append(s)
            return out[:32]
        return []

    @field_validator("chat_prompt_templates", mode="before")
    @classmethod
    def _coerce_templates(cls, v: object) -> list[dict[str, str]]:
        if v is None:
            return []
        if not isinstance(v, list):
            return []
        out: list[dict[str, str]] = []
        for item in v[:24]:
            if isinstance(item, dict):
                name = str(item.get("name") or "")[:80]
                body = str(item.get("body") or "")[:8000]
                if name or body:
                    out.append({"name": name, "body": body})
        return out

    @field_validator("chat_quick_prompts", mode="before")
    @classmethod
    def _coerce_quick(cls, v: object) -> list[str]:
        if v is None:
            return []
        if isinstance(v, str):
            parts = re.split(r"[\n\r]+", v)
            return [p.strip()[:500] for p in parts if p.strip()][:24]
        if isinstance(v, list):
            out: list[str] = []
            for x in v[:24]:
                s = str(x).strip()[:500]
                if s:
                    out.append(s)
            return out
        return []


class ChatMessageIn(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessageIn]
    use_rag: bool = True
    chat_mode: Literal["default", "interview"] = "default"
    # 用户从记忆档案钉选的一条全文，会优先写入系统提示（仍可与向量检索结果合并）
    pinned_context: str | None = Field(default=None, max_length=32000)
    # 将本轮用户句与助手完整回复写入本地向量库，与导入聊天记录同源，供后续 RAG
    persist_to_memory: bool = True
    # 追加到系统提示末尾（人设 / 灵魂问答补充）
    extra_system: str | None = Field(default=None, max_length=8000)
    # RAG 仅检索匹配平台 / 时间范围的向量（与记忆库 browse 语义一致）
    rag_platform: str | None = Field(default=None, max_length=128)
    rag_ts_from: str | None = Field(default=None, max_length=80)
    rag_ts_to: str | None = Field(default=None, max_length=80)
    rag_thread: str | None = Field(default=None, max_length=500)
    rag_sender_mode: Literal["any", "self_only", "exclude_self"] = "any"


class RagPreviewRequest(BaseModel):
    """仅向量检索，不调用大模型；用于对话页实时预览相关记忆。"""
    query: str = Field(default="", max_length=4000)
    n: int = Field(default=8, ge=1, le=20)
    rag_platform: str | None = Field(default=None, max_length=128)
    rag_ts_from: str | None = Field(default=None, max_length=80)
    rag_ts_to: str | None = Field(default=None, max_length=80)
    rag_thread: str | None = Field(default=None, max_length=500)
    rag_sender_mode: Literal["any", "self_only", "exclude_self"] = "any"


class SkillExportRequest(BaseModel):
    skill_name: str = Field(..., min_length=1, max_length=64)
    use_llm: bool = True


class ProfilePatch(BaseModel):
    persona_summary: str | None = None
    values_notes: str | None = None
    fear_desire_notes: str | None = None


class SummarizeRequest(BaseModel):
    use_llm: bool = True


class MemoryDeleteRequest(BaseModel):
    ids: list[str] = Field(..., min_length=1, max_length=200)


class MemoryItemUpdate(BaseModel):
    """更新单条向量记忆：至少改一项；正文变更会触发重新嵌入。"""

    id: str = Field(..., min_length=1, max_length=512)
    document: str | None = Field(default=None, max_length=120_000)
    sender: str | None = Field(default=None, max_length=500)
    platform: str | None = Field(default=None, max_length=128)
    ts: str | None = Field(default=None, max_length=120)
    thread: str | None = Field(default=None, max_length=500)
    tags: str | None = Field(
        default=None,
        max_length=2000,
        description="自由标签，逗号或空格分隔，便于筛选",
    )

    @model_validator(mode="after")
    def at_least_one_field(self) -> MemoryItemUpdate:
        if all(
            x is None
            for x in (
                self.document,
                self.sender,
                self.platform,
                self.ts,
                self.thread,
                self.tags,
            )
        ):
            raise ValueError(
                "至少需要提供 document / sender / platform / ts / thread / tags 中的一项"
            )
        return self


class ChatArchiveCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    messages: list[ChatMessageIn] = Field(default_factory=list)
    extra_system: str | None = Field(default=None, max_length=8000)

    @field_validator("messages", mode="after")
    @classmethod
    def _cap_messages(cls, v: list[ChatMessageIn]) -> list[ChatMessageIn]:
        return v[:400] if v else []
