from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.requests import Request
from starlette.responses import JSONResponse

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

    @application.middleware("http")
    async def api_bearer_guard(request: Request, call_next):
        path = request.url.path
        if not path.startswith("/api"):
            return await call_next(request)
        if path == "/api/health":
            return await call_next(request)
        tok = (get_settings().api_bearer_token or "").strip()
        if tok:
            auth = request.headers.get("authorization", "")
            if auth != f"Bearer {tok}":
                return JSONResponse({"detail": "Unauthorized"}, status_code=401)
        return await call_next(request)

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
