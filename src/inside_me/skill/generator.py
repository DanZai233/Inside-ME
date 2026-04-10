from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import yaml

from inside_me.analysis.profile import ProfileState


def validate_skill_name(name: str) -> str:
    s = name.strip().lower()
    s = re.sub(r"[^a-z0-9-]+", "-", s)
    s = re.sub(r"-{2,}", "-", s).strip("-")
    if not s or len(s) > 64:
        raise ValueError("skill 名称需 1–64 字符，仅小写字母、数字、连字符，且不能首尾为连字符")
    return s


def _yaml_frontmatter(meta: dict[str, Any]) -> str:
    dumped = yaml.safe_dump(meta, allow_unicode=True, sort_keys=False).strip()
    return f"---\n{dumped}\n---\n"


def build_skill_markdown(
    skill_name: str,
    profile: ProfileState,
    llm_blocks: dict[str, str] | None,
    self_sender_aliases: list[str] | None = None,
) -> str:
    llm_blocks = llm_blocks or {}
    persona = llm_blocks.get("persona_summary") or profile.persona_summary or "（请基于用户数据补充：性格与自我描述）"
    comm = llm_blocks.get("communication_style") or "（请补充：语气、常用表达、节奏）"
    values = llm_blocks.get("values") or profile.values_notes or "（请补充：重视的原则与取舍）"
    fd = llm_blocks.get("fears_desires") or profile.fear_desire_notes or "（请补充：担忧与向往）"

    terms = ", ".join(f"{k}" for k, _ in profile.top_terms[:15])
    aliases = [x.strip() for x in (self_sender_aliases or []) if x.strip()]
    if aliases:
        shown = aliases[:40]
        alias_lines = "\n".join(f"- `{a}`" for a in shown)
        if len(aliases) > 40:
            alias_lines += f"\n- （另有 {len(aliases) - 40} 条未列出）"
        self_alias_section = (
            "## 本人发送者别名\n\n"
            "以下名单来自 Inside-ME「模型设置」中的**本人在导出里的昵称别名**，用于在原始聊天记录元数据（`sender`）中识别哪些消息是你本人发送的。"
            "宿主在引用 RAG、检索或平台导出时，可据此做「仅本人 / 排除本人」等过滤。\n\n"
            f"{alias_lines}\n"
        )
    else:
        self_alias_section = (
            "## 本人发送者别名\n\n"
            "导出时未在 Inside-ME「模型设置」中配置本人昵称别名；如需区分本人与他人，可在应用内填写后重新导出，"
            "或编辑 `references/MEMORY.md` 手写补充。\n"
        )
    description = (
        f"以用户真实语言风格、价值观与情感模式回应。当用户希望「像我自己一样思考」"
        f"或需要自我一致性建议时使用。关键词：自我画像、{terms[:400]}"
    )
    if len(description) > 1024:
        description = description[:1021] + "..."

    meta = {
        "name": skill_name,
        "description": description,
        "license": "MIT",
        # Agent Skills 可选字段：标明无捆绑脚本、纯说明型 skill，便于各宿主加载
        "compatibility": (
            "Text-only digital-twin skill from Inside-ME. "
            "No bundled scripts required. Use in Claude Code, Cursor, or any Agent Skills–compatible client."
        ),
        "metadata": {
            "inside-me-version": "0.1",
            "message-count-estimate": str(profile.message_count),
            "generator": "inside-me",
        },
    }
    body = f"""# 数字分身（中之我）

## 使用方式

当用户请求以第一人称、贴近其真实表达方式回应时，激活本 skill。优先保持其价值取舍与语气一致。

## 人格与自我叙事

{persona}

## 沟通风格

{comm}

## 价值观与原则

{values}

## 恐惧、渴望与敏感点

{fd}

## 数据与记忆（统计）

- 消息规模（估计）：{profile.message_count}
- 平台：{profile.platforms}
- 高频主题词（启发用，非定论）：{terms}

{self_alias_section}
## 增量维护

用户持续导入聊天记录或对话后，应重新导出 skill 以更新本文件；
或编辑 `references/MEMORY.md` 记录新的稳定结论。

详见 `references/MEMORY.md` 与 `references/NEXT_STEPS.md`。
"""
    return _yaml_frontmatter(meta) + "\n" + body


def export_skill_dir(
    output_dir: Path,
    skill_name: str,
    profile: ProfileState,
    llm_blocks: dict[str, str] | None = None,
    self_sender_aliases: list[str] | None = None,
) -> Path:
    name = validate_skill_name(skill_name)
    root = output_dir / name
    if root.exists() and not root.is_dir():
        raise FileExistsError(str(root))
    root.mkdir(parents=True, exist_ok=True)
    refs = root / "references"
    refs.mkdir(exist_ok=True)

    aliases_clean = [x.strip() for x in (self_sender_aliases or []) if x.strip()]
    md = build_skill_markdown(
        name, profile, llm_blocks, self_sender_aliases=aliases_clean or None
    )
    (root / "SKILL.md").write_text(md, encoding="utf-8")

    if aliases_clean:
        alias_md = "## 本人别名（Inside-ME 导出）\n\n" + "\n".join(
            f"- `{a}`" for a in aliases_clean[:60]
        )
        if len(aliases_clean) > 60:
            alias_md += f"\n- （另有 {len(aliases_clean) - 60} 条未列出）"
        alias_md += "\n"
    else:
        alias_md = (
            "## 本人别名（Inside-ME 导出）\n\n"
            "（未配置；可在应用「模型设置」填写后重新导出。）\n"
        )
    memory = (
        "# 记忆与摘录\n\n"
        "> 将由用户在后续版本写入更细的记忆节点；此处保留结构化统计备份。\n\n"
        f"- message_count: {profile.message_count}\n"
        f"- platforms: {profile.platforms}\n"
        f"- top_terms: {profile.top_terms}\n\n"
        f"{alias_md}"
    )
    (refs / "MEMORY.md").write_text(memory, encoding="utf-8")
    next_steps = (
        "# 下一步维护\n\n"
        "- 在 Inside-ME 中继续导入聊天记录或对话写入记忆后，重新导出本 skill，"
        "以同步 `SKILL.md` 中的统计与摘要。\n"
        "- 可编辑本文件或 `MEMORY.md`，手写补充长期稳定的自我结论"
        "（模型不会自动覆盖此处全文）。\n"
        "- 若使用可选的 API Token（`INSIDE_ME_API_BEARER_TOKEN`）保护后端，"
        "导出与备份前请在浏览器「模型设置」填写同一 Token。\n"
    )
    (refs / "NEXT_STEPS.md").write_text(next_steps, encoding="utf-8")
    return root
