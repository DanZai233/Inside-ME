from pathlib import Path
from typing import Any

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="INSIDE_ME_", env_file=".env", extra="ignore")

    data_dir: Path = Path.home() / ".inside-me"
    chroma_subdir: str = "chroma"
    settings_file: str = "settings.json"
    profile_file: str = "profile.json"

    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    # 非空时，所有 /api/* 请求需带 Header: Authorization: Bearer <token>（/api/health、/api/metrics 除外）
    api_bearer_token: str = ""
    # 为 true 时 stderr 输出单行 JSON 日志（便于采集）
    log_json: bool = False
    # 若存在且为目录，则在根路径托管前端静态资源（如 Vite build 的 dist）；与 /api 同端口即同源
    static_dir: Path | None = None

    @field_validator("static_dir", mode="before")
    @classmethod
    def _empty_static_dir(cls, v: Any) -> Path | None:
        if v is None or v == "":
            return None
        return Path(v) if not isinstance(v, Path) else v

    @property
    def chroma_path(self) -> Path:
        return self.data_dir / self.chroma_subdir

    @property
    def settings_path(self) -> Path:
        return self.data_dir / self.settings_file

    @property
    def profile_path(self) -> Path:
        return self.data_dir / self.profile_file


def get_settings() -> Settings:
    return Settings()
