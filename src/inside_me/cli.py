from __future__ import annotations

from pathlib import Path

import typer
import uvicorn

from inside_me.analysis.profile import (
    build_profile_from_store,
    load_profile,
    merge_profile_json,
    save_profile,
)
from inside_me.config import get_settings
from inside_me.parsers import parse_chat_file
from inside_me.prefs import load_user_settings
from inside_me.skill.generator import export_skill_dir, validate_skill_name
from inside_me.store import MessageStore

app = typer.Typer(no_args_is_help=True)


@app.command()
def serve(
    host: str = "127.0.0.1",
    port: int = 8000,
    reload: bool = typer.Option(False, "--reload", "-r", help="开发模式：代码变更自动重载"),
) -> None:
    """启动 Web API。"""
    uvicorn.run("inside_me.app:app", host=host, port=port, reload=reload)


@app.command("import")
def import_file(
    path: Path = typer.Argument(..., exists=True, readable=True, path_type=Path),
    no_dedupe: bool = typer.Option(False, "--no-dedupe", help="关闭内容去重，全部写入向量库"),
) -> None:
    """导入聊天记录文件到本地向量库。"""
    settings = get_settings()
    store = MessageStore(settings, load_user_settings(settings.settings_path))
    raw = path.read_text(encoding="utf-8", errors="replace")
    messages, platform = parse_chat_file(path, raw)
    if not messages:
        typer.echo("未能解析出消息。", err=True)
        raise typer.Exit(1)
    texts = [m.text for m in messages]
    metas = [
        {
            "sender": m.sender or "",
            "platform": m.platform,
            "ts": m.ts.isoformat() if m.ts else "",
        }
        for m in messages
    ]
    added, skipped = store.add_messages(texts, metas, source=platform, dedupe=not no_dedupe)
    prev = load_profile(settings.profile_path)
    fresh = build_profile_from_store(store, previous=prev)
    merged = merge_profile_json(prev, fresh) if prev else fresh
    save_profile(settings.profile_path, merged)
    if skipped:
        typer.echo(
            f"新增 {added} 条、跳过重复 {skipped} 条，解析平台: {platform}，画像已更新。"
        )
    else:
        typer.echo(f"已写入 {added} 条向量，解析平台: {platform}，画像已更新。")


@app.command()
def skill(
    name: str = typer.Argument(..., help="skill 目录名（小写、连字符）"),
    out: Path = typer.Option(Path("dist-skills"), "--out", "-o", path_type=Path),
) -> None:
    """根据当前画像导出 AgentSkills 目录。"""
    settings = get_settings()
    try:
        skill_name = validate_skill_name(name)
    except ValueError as e:
        typer.echo(str(e), err=True)
        raise typer.Exit(1) from e
    store = MessageStore(settings, load_user_settings(settings.settings_path))
    prof = load_profile(settings.profile_path) or build_profile_from_store(store)
    root = export_skill_dir(out, skill_name, prof, llm_blocks=None)
    typer.echo(str(root.resolve()))


def main() -> None:
    app()


if __name__ == "__main__":
    main()
