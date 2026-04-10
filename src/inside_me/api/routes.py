from __future__ import annotations

import csv
import io
import json
import logging
import shutil
import zipfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated, Any, Literal

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import PlainTextResponse, StreamingResponse
from pydantic import BaseModel

from inside_me import metrics as http_metrics
from inside_me.analysis.llm import openai_compatible_chat_stream, summarize_for_skill
from inside_me.analysis.profile import (
    ProfileState,
    build_profile_from_store,
    load_profile,
    merge_profile_json,
    save_profile,
)
from inside_me.analysis.filters import distinct_threads, filter_message_rows
from inside_me.analysis.profile import build_profile_from_rows
from inside_me.analysis.social import compute_social_stats
from inside_me.analysis.timeline import compute_timeline
from inside_me.analysis.topics import compute_keyword_topics
from inside_me.api import import_jobs
from inside_me.api.schemas import (
    ChatArchiveCreate,
    ChatRequest,
    MemoryDeleteRequest,
    MemoryItemUpdate,
    ProfilePatch,
    RagPreviewRequest,
    SkillExportRequest,
    SummarizeRequest,
    UserSettings,
)
from inside_me.chat_archives import (
    create_archive,
    delete_archive,
    get_archive,
    list_archives,
)
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

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api")


@router.get("/metrics")
def prometheus_metrics() -> PlainTextResponse:
    """Prometheus 文本指标（与 /api/health 相同，不设 Bearer 时可抓取）。"""
    return PlainTextResponse(
        content=http_metrics.prometheus_text(),
        media_type="text/plain; version=0.0.4; charset=utf-8",
    )


def _serialize_rag_hits(hits: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for h in hits:
        doc = h.get("document") or ""
        meta = h.get("metadata") or {}
        if not isinstance(meta, dict):
            meta = {}
        short = doc.replace("\n", " ").strip()
        if len(short) > 180:
            short = short[:180] + "…"
        out.append(
            {
                "id": str(h.get("id") or ""),
                "text": doc,
                "preview": short,
                "sender": str(meta.get("sender") or ""),
                "platform": str(meta.get("platform") or ""),
                "ts": str(meta.get("ts") or ""),
                "thread": str(meta.get("thread") or ""),
                "tags": str(meta.get("tags") or ""),
                "distance": h.get("distance"),
            }
        )
    return out


def _persist_chat_turn_to_store(
    store: MessageStore,
    settings: Settings,
    user_text: str,
    assistant_text: str,
) -> None:
    """把一轮对话写入向量库，元数据与文件导入一致，便于后续检索与画像统计。"""
    u = user_text.strip()
    a = assistant_text.strip()
    if not u or not a:
        return
    now = datetime.now(UTC).isoformat()
    platform = "inside-me"
    texts = [u, a]
    metas: list[dict[str, Any]] = [
        {"sender": "我", "platform": platform, "ts": now, "thread": "对话"},
        {"sender": "数字分身", "platform": platform, "ts": now, "thread": "对话"},
    ]
    store.add_messages(texts, metas, source="inside-me", dedupe=True)
    prev = load_profile(settings.profile_path)
    fresh = build_profile_from_store(store, previous=prev)
    merged = merge_profile_json(prev, fresh) if prev else fresh
    merged.updated_at = datetime.now(UTC).isoformat()
    save_profile(settings.profile_path, merged)


def _build_chat_api_messages(
    body: ChatRequest,
    store: MessageStore,
    settings: Settings,
) -> tuple[list[dict[str, str]], list[dict[str, Any]]]:
    u = load_user_settings(settings.settings_path)
    prof = load_profile(settings.profile_path) or build_profile_from_store(store)
    last_user = next((m.content for m in reversed(body.messages) if m.role == "user"), "")
    hits: list[dict[str, Any]] = []
    if body.use_rag and last_user:
        hits = store.query(
            last_user,
            n=8,
            platform=body.rag_platform,
            ts_from=body.rag_ts_from,
            ts_to=body.rag_ts_to,
            sender_mode=body.rag_sender_mode,
            self_aliases=u.self_sender_aliases,
            thread=body.rag_thread,
        )
    rag_hits = _serialize_rag_hits(hits)
    context_blocks = [h["document"] for h in hits if h.get("document")]
    rag = "\n\n---\n\n".join(context_blocks[:8])
    pin = (body.pinned_context or "").strip()
    if pin and len(pin) > 12000:
        pin = pin[:12000]

    system = (
        "你是用户的「数字分身」对话助手：语气自然、贴近其真实自我表达，保持价值一致性与同理心。\n"
        "【如何使用记忆】下列「相关聊天摘录」来自本地向量检索，是背景材料。请内化后回应，不要逐条复述或像写文献综述；"
        "除非用户明确追问「某段记录里你怎么说」，否则不必交代「根据第几条记忆」。\n"
        "若钉选记忆与摘录有冲突，以更贴近用户当下问题的一侧为准，并可温和说明你在综合不同时间的自己。\n\n"
        f"【画像摘要】{prof.persona_summary or '（待补充）'}\n"
        f"【价值观笔记】{prof.values_notes or '（待补充）'}\n"
    )
    if pin:
        system += f"\n【用户钉选的一条记忆（优先关注）】\n{pin}\n"
    if rag:
        system += f"\n【相关聊天摘录（RAG）】\n{rag}\n"

    if body.chat_mode == "interview":
        system += (
            "\n【对话模式：深度访谈】以心理访谈式的节奏回应：先简短反映对方感受或要点，再用一两句澄清式提问，"
            "帮助对方把价值观、恐惧、渴望说得更具体；每次最多两个问句；不做诊断、不替代专业心理咨询。\n"
        )
    extra = (body.extra_system or "").strip()
    if extra:
        system += "\n\n【用户自定义系统补充】\n" + extra[:8000]

    msgs: list[dict[str, str]] = [{"role": "system", "content": system}]
    for m in body.messages:
        msgs.append({"role": m.role, "content": m.content})
    return msgs, rag_hits


def _store_dep(s: Annotated[Settings, Depends(get_settings)]) -> MessageStore:
    u = load_user_settings(s.settings_path)
    return MessageStore(s, u)


@router.get("/health")
def health(
    store: Annotated[MessageStore, Depends(_store_dep)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, Any]:
    free_gb: float | None = None
    try:
        usage = shutil.disk_usage(settings.data_dir)
        free_gb = round(usage.free / (1024**3), 2)
    except Exception:
        pass
    return {
        "status": "ok",
        "vectors": store.count(),
        "data_dir": str(settings.data_dir.resolve()),
        "disk_free_gb": free_gb,
    }


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
        self_sender_aliases=body.self_sender_aliases,
        chat_prompt_templates=list(body.chat_prompt_templates),
        chat_quick_prompts=list(body.chat_quick_prompts),
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


def _archives_file(settings: Settings) -> Path:
    return settings.data_dir / "chat_archives.json"


@router.get("/dashboard")
def dashboard(
    store: Annotated[MessageStore, Depends(_store_dep)],
    settings: Annotated[Settings, Depends(get_settings)],
    stats_platform: str | None = Query(None, max_length=128),
    stats_ts_from: str | None = Query(None, max_length=80),
    stats_ts_to: str | None = Query(None, max_length=80),
    stats_thread: str | None = Query(None, max_length=500),
    stats_sender_mode: str = Query(
        "any",
        description="any | self_only | exclude_self",
    ),
    timeline_granularity: Literal["day", "week"] = Query("day"),
) -> dict[str, Any]:
    u = load_user_settings(settings.settings_path)
    prev = load_profile(settings.profile_path)
    raw_rows = store.list_messages_for_stats(8000)
    sm = stats_sender_mode if stats_sender_mode in ("any", "self_only", "exclude_self") else "any"
    filtered = filter_message_rows(
        raw_rows,
        platform=stats_platform,
        ts_from=stats_ts_from,
        ts_to=stats_ts_to,
        thread=stats_thread,
        sender_mode=sm,
        self_aliases=u.self_sender_aliases,
    )
    filters_active = any(
        [
            stats_platform and stats_platform.strip(),
            stats_ts_from and stats_ts_from.strip(),
            stats_ts_to and stats_ts_to.strip(),
            stats_thread and stats_thread.strip(),
            sm != "any",
        ]
    )
    if filters_active:
        prof = build_profile_from_rows(
            filtered, previous=prev, total_message_count=store.count()
        )
    else:
        prof = build_profile_from_store(store, previous=prev)
        save_profile(settings.profile_path, prof)
    social = compute_social_stats(
        filtered, max_rows=len(filtered), self_aliases=u.self_sender_aliases
    )
    timeline = compute_timeline(filtered, granularity=timeline_granularity)
    topics = compute_keyword_topics(filtered)
    thread_options = distinct_threads(raw_rows)
    return {
        "message_count": store.count(),
        "stats_sample_cap": 8000,
        "stats_matching": len(filtered),
        "filters_active": filters_active,
        "stats_filters": {
            "platform": stats_platform,
            "ts_from": stats_ts_from,
            "ts_to": stats_ts_to,
            "thread": stats_thread,
            "sender_mode": sm,
        },
        "profile": prof.to_public_dict(),
        "social": social,
        "timeline": timeline,
        "topics": topics,
        "thread_options": thread_options,
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
    p.updated_at = datetime.now(UTC).isoformat()
    save_profile(settings.profile_path, p)
    return p


@router.post("/import/preview")
async def import_preview(file: UploadFile = File(...)) -> dict[str, Any]:
    raw = (await file.read()).decode("utf-8", errors="replace")
    path = Path(file.filename or "upload.txt")
    messages, platform = parse_chat_file(path, raw)
    preview = [
        {
            "text": (m.text[:500] + "…") if len(m.text) > 500 else m.text,
            "sender": m.sender,
            "ts": m.ts.isoformat() if m.ts else "",
            "platform": m.platform,
            "thread": m.thread or "",
        }
        for m in messages[:40]
    ]
    return {"platform": platform, "total_parsed": len(messages), "preview": preview}


@router.post("/import")
async def import_chat(
    store: Annotated[MessageStore, Depends(_store_dep)],
    settings: Annotated[Settings, Depends(get_settings)],
    file: UploadFile = File(...),
    dedupe: bool = Query(True, description="跳过与库内内容哈希重复的消息"),
) -> dict:
    raw = (await file.read()).decode("utf-8", errors="replace")
    path = Path(file.filename or "upload.txt")
    messages, platform = parse_chat_file(path, raw)
    if not messages:
        raise HTTPException(
            400,
            "未能解析出消息，请检查格式（QQ / 微信 / 微博 / Telegram JSON / Discord CSV / 通用逐行等）",
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
                "thread": m.thread or "",
            }
        )
    added, skipped = store.add_messages(texts, metas, source=platform, dedupe=dedupe)
    prev = load_profile(settings.profile_path)
    fresh = build_profile_from_store(store, previous=prev)
    merged = merge_profile_json(prev, fresh) if prev else fresh
    merged.updated_at = datetime.now(UTC).isoformat()
    save_profile(settings.profile_path, merged)
    return {
        "imported": added,
        "skipped_duplicates": skipped,
        "platform": platform,
        "parsed_messages": len(messages),
    }


@router.post("/import/job")
async def import_job_start(
    background_tasks: BackgroundTasks,
    settings: Annotated[Settings, Depends(get_settings)],
    file: UploadFile = File(...),
    dedupe: bool = Query(True, description="跳过与库内内容哈希重复的消息"),
) -> dict[str, str]:
    raw = await file.read()
    jid = import_jobs.create_job(file.filename or "upload.txt")
    tmp_root = settings.data_dir / "import_jobs"
    tmp_root.mkdir(parents=True, exist_ok=True)
    path = tmp_root / f"{jid}.upload"
    path.write_bytes(raw)
    background_tasks.add_task(import_jobs.run_import_job, jid, path, dedupe, settings)
    return {"job_id": jid}


@router.get("/import/job/{job_id}")
def import_job_status(job_id: str) -> dict[str, Any]:
    st = import_jobs.get_public_state(job_id)
    if not st:
        raise HTTPException(404, "未知任务")
    return st


@router.post("/import/job/{job_id}/cancel")
def import_job_cancel(job_id: str) -> dict[str, bool]:
    return {"ok": import_jobs.request_cancel(job_id)}


@router.get("/memory/browse")
def memory_browse(
    store: Annotated[MessageStore, Depends(_store_dep)],
    settings: Annotated[Settings, Depends(get_settings)],
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    platform: str | None = Query(None),
    q: str | None = Query(None, max_length=500),
    ts_from: str | None = Query(None, max_length=80, description="元数据 ts 下限（ISO 或 YYYY-MM-DD）"),
    ts_to: str | None = Query(None, max_length=80, description="元数据 ts 上限（ISO 或 YYYY-MM-DD，含当日）"),
    thread: str | None = Query(None, max_length=500),
    tag: str | None = Query(None, max_length=200),
    sender_mode: str = Query(
        "any",
        description="any | self_only | exclude_self（后两者依赖设置中的本人别名）",
    ),
) -> dict[str, Any]:
    sm = sender_mode if sender_mode in ("any", "self_only", "exclude_self") else "any"
    u = load_user_settings(settings.settings_path)
    rows, meta = store.browse_memory(
        limit=limit,
        offset=offset,
        platform=platform,
        q=q,
        ts_from=ts_from,
        ts_to=ts_to,
        sender_mode=sm,
        self_aliases=u.self_sender_aliases,
        thread=thread,
        tag=tag,
    )
    return {
        "items": _serialize_rag_hits(rows),
        "scan_capped": meta.get("scan_capped", False),
        "total_matching": meta.get("total_matching"),
    }


@router.post("/memory/delete")
def memory_delete(
    body: MemoryDeleteRequest,
    store: Annotated[MessageStore, Depends(_store_dep)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, int]:
    n = store.delete_by_ids(body.ids)
    prev = load_profile(settings.profile_path)
    fresh = build_profile_from_store(store, previous=prev)
    merged = merge_profile_json(prev, fresh) if prev else fresh
    merged.updated_at = datetime.now(UTC).isoformat()
    save_profile(settings.profile_path, merged)
    return {"deleted": n}


@router.patch("/memory/item")
def memory_item_patch(
    body: MemoryItemUpdate,
    store: Annotated[MessageStore, Depends(_store_dep)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, bool]:
    ok = store.update_message(
        body.id,
        document=body.document,
        sender=body.sender,
        platform=body.platform,
        ts=body.ts,
        thread=body.thread,
        tags=body.tags,
    )
    if not ok:
        raise HTTPException(404, "未找到该条记忆或更新失败")
    prev = load_profile(settings.profile_path)
    fresh = build_profile_from_store(store, previous=prev)
    merged = merge_profile_json(prev, fresh) if prev else fresh
    merged.updated_at = datetime.now(UTC).isoformat()
    save_profile(settings.profile_path, merged)
    return {"ok": True}


@router.get("/analytics/social-export", response_model=None)
def analytics_social_export(
    store: Annotated[MessageStore, Depends(_store_dep)],
    settings: Annotated[Settings, Depends(get_settings)],
    export_format: Literal["json", "csv"] = Query("json", alias="format"),
    stats_platform: str | None = Query(None, max_length=128),
    stats_ts_from: str | None = Query(None, max_length=80),
    stats_ts_to: str | None = Query(None, max_length=80),
    stats_thread: str | None = Query(None, max_length=500),
    stats_sender_mode: str = Query("any"),
) -> Any:
    """导出发送者统计与相邻对（与当前仪表盘筛选一致，基于最多 8000 条样本）。"""
    u = load_user_settings(settings.settings_path)
    raw_rows = store.list_messages_for_stats(8000)
    sm = stats_sender_mode if stats_sender_mode in ("any", "self_only", "exclude_self") else "any"
    filtered = filter_message_rows(
        raw_rows,
        platform=stats_platform,
        ts_from=stats_ts_from,
        ts_to=stats_ts_to,
        thread=stats_thread,
        sender_mode=sm,
        self_aliases=u.self_sender_aliases,
    )
    social = compute_social_stats(
        filtered, max_rows=len(filtered), self_aliases=u.self_sender_aliases
    )
    payload: dict[str, Any] = {
        "exported_at": datetime.now(UTC).isoformat(),
        "stats_sample_cap": 8000,
        "stats_matching": len(filtered),
        "filters": {
            "platform": stats_platform,
            "ts_from": stats_ts_from,
            "ts_to": stats_ts_to,
            "thread": stats_thread,
            "sender_mode": sm,
        },
        "top_senders": social.get("top_senders", []),
        "adjacent_pairs": social.get("adjacent_pairs", []),
    }
    if export_format == "json":
        return payload
    buf = io.StringIO()
    buf.write("\ufeff")
    buf.write("# top_senders\n")
    w = csv.writer(buf)
    w.writerow(["name", "count", "is_self"])
    for row in social.get("top_senders", []):
        if isinstance(row, dict):
            w.writerow(
                [
                    row.get("name", ""),
                    row.get("count", ""),
                    row.get("is_self", ""),
                ]
            )
    buf.write("\n# adjacent_pairs\n")
    w = csv.writer(buf)
    w.writerow(["a", "b", "count", "involves_self", "a_is_self", "b_is_self"])
    for row in social.get("adjacent_pairs", []):
        if isinstance(row, dict):
            w.writerow(
                [
                    row.get("a", ""),
                    row.get("b", ""),
                    row.get("count", ""),
                    row.get("involves_self", ""),
                    row.get("a_is_self", ""),
                    row.get("b_is_self", ""),
                ]
            )
    return PlainTextResponse(
        content=buf.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="inside-me-social-export.csv"'},
    )


@router.get("/chat/archives")
def chat_archives_list(settings: Annotated[Settings, Depends(get_settings)]) -> dict[str, Any]:
    return {"archives": list_archives(_archives_file(settings))}


@router.post("/chat/archives")
def chat_archives_create(
    body: ChatArchiveCreate,
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, Any]:
    msgs = [{"role": m.role, "content": m.content} for m in body.messages]
    item = create_archive(
        _archives_file(settings),
        name=body.name,
        messages=msgs,
        extra_system=body.extra_system,
    )
    return {"archive": item}


@router.get("/chat/archives/{archive_id}")
def chat_archives_get(
    archive_id: str,
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, Any]:
    r = get_archive(_archives_file(settings), archive_id)
    if not r:
        raise HTTPException(404, "未找到存档")
    return {"archive": r}


@router.delete("/chat/archives/{archive_id}")
def chat_archives_delete(
    archive_id: str,
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, bool]:
    ok = delete_archive(_archives_file(settings), archive_id)
    if not ok:
        raise HTTPException(404, "未找到存档")
    return {"ok": True}


@router.get("/backup/download")
def backup_download(settings: Annotated[Settings, Depends(get_settings)]) -> StreamingResponse:
    root = settings.data_dir.resolve()
    if not root.is_dir():
        raise HTTPException(404, "数据目录不存在")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for p in root.rglob("*"):
            if p.is_file():
                try:
                    zf.write(p, p.relative_to(root))
                except Exception:
                    logger.warning("skip backup path %s", p)
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="inside-me-backup.zip"'},
    )


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
    prof.updated_at = datetime.now(UTC).isoformat()
    save_profile(settings.profile_path, prof)
    return SummarizeResult(profile=prof, llm=llm_out)


@router.post("/chat/rag-preview")
def chat_rag_preview(
    body: RagPreviewRequest,
    store: Annotated[MessageStore, Depends(_store_dep)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, list[dict[str, Any]]]:
    q = (body.query or "").strip()
    if len(q) < 2:
        return {"rag_hits": []}
    u = load_user_settings(settings.settings_path)
    hits = store.query(
        q,
        n=body.n,
        platform=body.rag_platform,
        ts_from=body.rag_ts_from,
        ts_to=body.rag_ts_to,
        sender_mode=body.rag_sender_mode,
        self_aliases=u.self_sender_aliases,
        thread=body.rag_thread,
    )
    return {"rag_hits": _serialize_rag_hits(hits)}


@router.post("/chat/stream")
async def chat_stream(
    body: ChatRequest,
    store: Annotated[MessageStore, Depends(_store_dep)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> StreamingResponse:
    u = load_user_settings(settings.settings_path)
    if not u.api_key or u.api_key.startswith("****"):
        raise HTTPException(400, "请配置 API Key")

    msgs, rag_hits = _build_chat_api_messages(body, store, settings)
    hits_out = rag_hits if body.use_rag else []

    async def event_gen() -> Any:
        meta = {"type": "meta", "rag_hits": hits_out}
        yield f"data: {json.dumps(meta, ensure_ascii=False)}\n\n"
        assistant_buf: list[str] = []
        try:
            async for chunk in openai_compatible_chat_stream(
                base_url=u.api_base_url,
                api_key=u.api_key,
                model=u.model,
                messages=msgs,
            ):
                if chunk:
                    assistant_buf.append(chunk)
                    yield f"data: {json.dumps({'type': 'delta', 'content': chunk}, ensure_ascii=False)}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)}, ensure_ascii=False)}\n\n"
            return
        full_reply = "".join(assistant_buf)
        if body.persist_to_memory and body.messages and body.messages[-1].role == "user" and full_reply.strip():
            try:
                _persist_chat_turn_to_store(store, settings, body.messages[-1].content, full_reply)
            except Exception:
                logger.exception("写入对话到本地记忆库失败")
        yield f"data: {json.dumps({'type': 'done'}, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/chat")
async def chat(
    body: ChatRequest,
    store: Annotated[MessageStore, Depends(_store_dep)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, Any]:
    u = load_user_settings(settings.settings_path)
    if not u.api_key or u.api_key.startswith("****"):
        raise HTTPException(400, "请配置 API Key")

    from inside_me.analysis.llm import openai_compatible_chat

    msgs, rag_hits = _build_chat_api_messages(body, store, settings)
    reply = await openai_compatible_chat(
        base_url=u.api_base_url, api_key=u.api_key, model=u.model, messages=msgs
    )
    if (
        body.persist_to_memory
        and body.messages
        and body.messages[-1].role == "user"
        and reply.strip()
    ):
        try:
            _persist_chat_turn_to_store(store, settings, body.messages[-1].content, reply)
        except Exception:
            logger.exception("写入对话到本地记忆库失败")
    return {"reply": reply, "rag_hits": rag_hits if body.use_rag else []}


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
    u = load_user_settings(settings.settings_path)
    llm_blocks: dict[str, str] | None = None
    if body.use_llm:
        if not u.api_key or u.api_key.startswith("****"):
            raise HTTPException(400, "导出需要 LLM 时请配置有效 API Key，或关闭 use_llm")
        sample = [x["text"] for x in store.peek_sample(120)]
        llm_blocks = await summarize_for_skill(u.api_base_url, u.api_key, u.model, prof, sample)
        prof.persona_summary = llm_blocks.get("persona_summary", prof.persona_summary)
        prof.values_notes = llm_blocks.get("values", prof.values_notes)
        prof.fear_desire_notes = llm_blocks.get("fears_desires", prof.fear_desire_notes)
        save_profile(settings.profile_path, prof)

    out_base = settings.data_dir / "exports"
    path = export_skill_dir(
        out_base, name, prof, llm_blocks, self_sender_aliases=u.self_sender_aliases
    )
    return {"path": str(path.resolve())}
