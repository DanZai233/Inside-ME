from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator


class UserSettings(BaseModel):
    api_base_url: str = Field(default="https://api.openai.com")
    api_key: str = Field(default="")
    model: str = Field(default="gpt-4o-mini")
    # 使用与对话相同的 Base URL + API Key，走 OpenAI 兼容 /v1/embeddings 或火山 /api/v3/embeddings
    use_remote_embedding: bool = False
    embedding_model: str = Field(default="", description="如火山方舟的 Embedding 模型名或 Endpoint ID")
    # 强制走方舟 /embeddings/multimodal；留 false 时若模型名含 embedding-vision 会自动启用
    embedding_ark_multimodal: bool = False


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


class RagPreviewRequest(BaseModel):
    """仅向量检索，不调用大模型；用于对话页实时预览相关记忆。"""
    query: str = Field(default="", max_length=4000)
    n: int = Field(default=8, ge=1, le=20)


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

    @model_validator(mode="after")
    def at_least_one_field(self) -> MemoryItemUpdate:
        if all(
            x is None
            for x in (self.document, self.sender, self.platform, self.ts)
        ):
            raise ValueError("至少需要提供 document / sender / platform / ts 中的一项")
        return self
