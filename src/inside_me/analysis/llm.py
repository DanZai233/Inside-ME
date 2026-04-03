from __future__ import annotations

import json
from typing import Any

import httpx

from inside_me.analysis.profile import ProfileState
from inside_me.openai_compat import httpx_client_kwargs, openai_compatible_chat_completions_url


async def openai_compatible_chat(
    *,
    base_url: str,
    api_key: str,
    model: str,
    messages: list[dict[str, str]],
    temperature: float = 0.6,
) -> str:
    url = openai_compatible_chat_completions_url(base_url)
    payload: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
    }
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(**httpx_client_kwargs(120.0)) as client:
        r = await client.post(url, headers=headers, json=payload)
        r.raise_for_status()
        data = r.json()
    return str(data["choices"][0]["message"]["content"])


async def deepen_persona_prompt(
    base_url: str,
    api_key: str,
    model: str,
    profile: ProfileState,
    user_message: str,
) -> str:
    terms = ", ".join(f"{k}({v})" for k, v in profile.top_terms[:12])
    system = (
        "你是一位温和、专业的心理访谈者，帮助用户觉察价值观、恐惧与渴望。"
        "回答简洁，可追问 1–2 个具体问题。使用用户使用的语言。"
    )
    ctx = (
        f"已知统计：消息约 {profile.message_count} 条；平台分布 {profile.platforms}；"
        f"高频词：{terms}。\n已有画像摘要：{profile.persona_summary or '（暂无）'}"
    )
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": ctx + "\n\n用户说：\n" + user_message},
    ]
    return await openai_compatible_chat(
        base_url=base_url, api_key=api_key, model=model, messages=messages
    )


async def summarize_for_skill(
    base_url: str,
    api_key: str,
    model: str,
    profile: ProfileState,
    sample_texts: list[str],
) -> dict[str, str]:
    blob = "\n---\n".join(sample_texts[:80])
    system = (
        "根据聊天记录样本与统计，输出 JSON，键：persona_summary, communication_style, "
        "values, fears_desires。各值为一段中文 Markdown 友好短文本。只输出 JSON。"
    )
    user = (
        f"统计：消息数 {profile.message_count}，平台 {json.dumps(profile.platforms, ensure_ascii=False)}，"
        f"高频词 {profile.top_terms[:15]}。\n样本：\n{blob[:12000]}"
    )
    raw = await openai_compatible_chat(
        base_url=base_url,
        api_key=api_key,
        model=model,
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        temperature=0.3,
    )
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[-1]
        raw = raw.rsplit("```", 1)[0].strip()
    try:
        data = json.loads(raw)
        return {k: str(data.get(k, "")) for k in ("persona_summary", "communication_style", "values", "fears_desires")}
    except json.JSONDecodeError:
        return {
            "persona_summary": raw[:2000],
            "communication_style": "",
            "values": "",
            "fears_desires": "",
        }
