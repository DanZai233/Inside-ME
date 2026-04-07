from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from inside_me.api.routes import router
from inside_me.config import get_settings


@asynccontextmanager
async def lifespan(_app: FastAPI):
    get_settings().data_dir.mkdir(parents=True, exist_ok=True)
    yield


def create_app() -> FastAPI:
    s = get_settings()
    application = FastAPI(title="Inside-ME API", version="0.1.0", lifespan=lifespan)

    @application.get("/health")
    def root_health() -> dict[str, str]:
        return {"status": "ok"}
    origins = [o.strip() for o in s.cors_origins.split(",") if o.strip()]
    application.add_middleware(
        CORSMiddleware,
        allow_origins=origins or ["http://localhost:5173"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    application.include_router(router)
    static = s.static_dir
    if static is not None:
        resolved = static.resolve()
        if resolved.is_dir():
            application.mount(
                "/",
                StaticFiles(directory=str(resolved), html=True),
                name="static",
            )
    return application


app = create_app()
