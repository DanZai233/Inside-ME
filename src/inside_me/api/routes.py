from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel

from inside_me.analysis.llm import summarize_for_skill
from inside_me.analysis.social import compute_social_stats
from inside_me.analysis.profile import (
    ProfileState,
    build_profile_from_store,
    load_profile,
    merge_profile_json,
    save_profile,
)
from inside_me.api.schemas import ChatRequest, ProfilePatch, SkillExportRequest, SummarizeRequest, UserSettings
from inside_me.config import Settings, get_settings
from inside_me.parsers import parse_chat_file
from inside_me.prefs import (
    load_user_settings,
    remote_embedding_enabled,
    save_user_settings,
    use_ark_multimodal_embeddings,
)
from inside_me.skill.generator import export_skill_dir, validate_skill_name
from inside_me.store import MessageStore

router = APIRouter(prefix="/api")


def _store_dep(s: Annotated[Settings, Depends(get_settings)]) -> MessageStore:
    u = load_user_settings(s.settings_path)
    return MessageStore(s, u)


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/settings", response_model=UserSettings)
def get_api_settings(settings: Annotated[Settings, Depends(get_settings)]) -> UserSettings:
    u = load_user_settings(settings.settings_path)
    if not u.api_key:
        return u
    masked = u.api_key[:4] + "…" + u.api_key[-2:] if len(u.api_key) > 6 else "****"
    return u.model_copy(update={"api_key": masked})


@router.post("/settings")
def post_api_settings(
    body: UserSettings,
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, str]:
    existing = load_user_settings(settings.settings_path)
    key = (body.api_key or "").strip()
    if not key or key.startswith("****") or "…" in key:
        key = existing.api_key

    emb = (body.embedding_model or "").strip()
    chat_m = (body.model or existing.model or "").strip()
    if body.use_remote_embedding:
        if not emb:
            raise HTTPException(
                400,
                "已开启云端嵌入，必须填写「向量模型 ID」（与对话模型不同，须支持方舟 Embedding / OpenAI embeddings 接口）。",
            )
        if emb == chat_m:
            raise HTTPException(
                400,
                "向量模型不能与对话模型相同。对话用 Chat 接入点（如 doubao-seed-…），向量须在控制台另选 Embedding 模型或对应 ep-。",
            )

    merged = UserSettings(
        api_base_url=body.api_base_url or existing.api_base_url,
        api_key=key,
        model=body.model or existing.model,
        use_remote_embedding=body.use_remote_embedding,
        embedding_model=emb,
        embedding_ark_multimodal=body.embedding_ark_multimodal,
    )
    if remote_embedding_enabled(merged) and use_ark_multimodal_embeddings(merged):
        base = merged.api_base_url.rstrip("/")
        if not base.endswith("/api/v3"):
            raise HTTPException(
                400,
                "多模态向量（doubao-embedding-vision 等）须使用方舟 Base URL，例如 https://ark.cn-beijing.volces.com/api/v3",
            )
    save_user_settings(settings.settings_path, merged)
    return {"status": "saved"}


@router.get("/dashboard")
def dashboard(
    store: Annotated[MessageStore, Depends(_store_dep)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict:
    prev = load_profile(settings.profile_path)
    prof = build_profile_from_store(store, previous=prev)
    save_profile(settings.profile_path, prof)
    stats_rows = store.list_messages_for_stats(8000)
    social = compute_social_stats(stats_rows, max_rows=8000)
    return {
        "message_count": store.count(),
        "profile": prof.to_public_dict(),
        "social": social,
    }


@router.get("/profile")
def get_profile(settings: Annotated[Settings, Depends(get_settings)]) -> ProfileState:
    p = load_profile(settings.profile_path)
    if p is None:
        raise HTTPException(404, "尚无画像，请先导入数据")
    return p


@router.patch("/profile")
def patch_profile(
    body: ProfilePatch,
    settings: Annotated[Settings, Depends(get_settings)],
) -> ProfileState:
    p = load_profile(settings.profile_path) or ProfileState()
    if body.persona_summary is not None:
        p.persona_summary = body.persona_summary
    if body.values_notes is not None:
        p.values_notes = body.values_notes
    if body.fear_desire_notes is not None:
        p.fear_desire_notes = body.fear_desire_notes
    p.updated_at = datetime.now(timezone.utc).isoformat()
    save_profile(settings.profile_path, p)
    return p


@router.post("/import")
async def import_chat(
    store: Annotated[MessageStore, Depends(_store_dep)],
    settings: Annotated[Settings, Depends(get_settings)],
    file: UploadFile = File(...),
) -> dict:
    raw = (await file.read()).decode("utf-8", errors="replace")
    path = Path(file.filename or "upload.txt")
    messages, platform = parse_chat_file(path, raw)
    if not messages:
        raise HTTPException(
            400,
            "未能解析出消息，请检查格式（QQ / 微信 / 微博时间块 / 通用逐行）",
        )

    texts: list[str] = []
    metas: list[dict] = []
    for m in messages:
        texts.append(m.text)
        metas.append(
            {
                "sender": m.sender or "",
                "platform": m.platform,
                "ts": m.ts.isoformat() if m.ts else "",
            }
        )
    n = store.add_messages(texts, metas, source=platform)
    prev = load_profile(settings.profile_path)
    fresh = build_profile_from_store(store, previous=prev)
    merged = merge_profile_json(prev, fresh) if prev else fresh
    merged.updated_at = datetime.now(timezone.utc).isoformat()
    save_profile(settings.profile_path, merged)
    return {"imported": n, "platform": platform, "parsed_messages": len(messages)}


class SummarizeResult(BaseModel):
    profile: ProfileState
    llm: dict[str, str] | None = None


@router.post("/profile/summarize", response_model=SummarizeResult)
async def summarize_profile(
    body: SummarizeRequest,
    store: Annotated[MessageStore, Depends(_store_dep)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> SummarizeResult:
    u = load_user_settings(settings.settings_path)
    prof = load_profile(settings.profile_path) or build_profile_from_store(store)
    llm_out: dict[str, str] | None = None
    if body.use_llm:
        if not u.api_key or u.api_key.startswith("****"):
            raise HTTPException(400, "请先在设置中配置有效 API Key")
        sample = [x["text"] for x in store.peek_sample(120)]
        llm_out = await summarize_for_skill(u.api_base_url, u.api_key, u.model, prof, sample)
        prof.persona_summary = llm_out.get("persona_summary", prof.persona_summary)
        prof.values_notes = llm_out.get("values", prof.values_notes)
        prof.fear_desire_notes = llm_out.get("fears_desires", prof.fear_desire_notes)
    prof.updated_at = datetime.now(timezone.utc).isoformat()
    save_profile(settings.profile_path, prof)
    return SummarizeResult(profile=prof, llm=llm_out)


@router.post("/chat")
async def chat(
    body: ChatRequest,
    store: Annotated[MessageStore, Depends(_store_dep)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, str]:
    u = load_user_settings(settings.settings_path)
    if not u.api_key or u.api_key.startswith("****"):
        raise HTTPException(400, "请配置 API Key")
    prof = load_profile(settings.profile_path) or build_profile_from_store(store)
    last_user = next((m.content for m in reversed(body.messages) if m.role == "user"), "")
    context_blocks: list[str] = []
    if body.use_rag and last_user:
        hits = store.query(last_user, n=6)
        for h in hits:
            context_blocks.append(h["document"])

    rag = "\n\n".join(context_blocks[:6])
    system = (
        "你是用户的「数字分身」对话助手：语气贴近其真实自我表达，保持价值一致性与同理心。"
        "若引用聊天记录，请概括意涵而非逐字复述。\n\n"
        f"【画像摘要】{prof.persona_summary or '（待补充）'}\n"
        f"【价值观笔记】{prof.values_notes or '（待补充）'}\n"
    )
    if rag:
        system += f"\n【相关聊天摘录（RAG）】\n{rag}\n"

    if body.chat_mode == "interview":
        system += (
            "\n【对话模式：深度访谈】以心理访谈式的节奏回应：先简短反映对方感受或要点，再用一两句澄清式提问，"
            "帮助对方把价值观、恐惧、渴望说得更具体；每次最多两个问句；不做诊断、不替代专业心理咨询。\n"
        )

    from inside_me.analysis.llm import openai_compatible_chat

    msgs = [{"role": "system", "content": system}]
    for m in body.messages:
        msgs.append({"role": m.role, "content": m.content})
    reply = await openai_compatible_chat(
        base_url=u.api_base_url, api_key=u.api_key, model=u.model, messages=msgs
    )
    return {"reply": reply}


@router.post("/skill/export")
async def skill_export(
    body: SkillExportRequest,
    store: Annotated[MessageStore, Depends(_store_dep)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, str]:
    try:
        name = validate_skill_name(body.skill_name)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    prof = load_profile(settings.profile_path) or build_profile_from_store(store)
    llm_blocks: dict[str, str] | None = None
    if body.use_llm:
        u = load_user_settings(settings.settings_path)
        if not u.api_key or u.api_key.startswith("****"):
            raise HTTPException(400, "导出需要 LLM 时请配置有效 API Key，或关闭 use_llm")
        sample = [x["text"] for x in store.peek_sample(120)]
        llm_blocks = await summarize_for_skill(u.api_base_url, u.api_key, u.model, prof, sample)
        prof.persona_summary = llm_blocks.get("persona_summary", prof.persona_summary)
        prof.values_notes = llm_blocks.get("values", prof.values_notes)
        prof.fear_desire_notes = llm_blocks.get("fears_desires", prof.fear_desire_notes)
        save_profile(settings.profile_path, prof)

    out_base = settings.data_dir / "exports"
    path = export_skill_dir(out_base, name, prof, llm_blocks)
    return {"path": str(path.resolve())}
