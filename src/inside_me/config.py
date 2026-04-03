from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="INSIDE_ME_", env_file=".env", extra="ignore")

    data_dir: Path = Path.home() / ".inside-me"
    chroma_subdir: str = "chroma"
    settings_file: str = "settings.json"
    profile_file: str = "profile.json"

    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

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
