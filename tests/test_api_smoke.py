from __future__ import annotations

import io
import time

import pytest
from fastapi.testclient import TestClient

from inside_me.app import create_app


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("INSIDE_ME_DATA_DIR", str(tmp_path))
    return TestClient(create_app())


def test_root_health() -> None:
    c = TestClient(create_app())
    r = c.get("/health")
    assert r.status_code == 200
    assert r.json().get("status") == "ok"


def test_api_health_no_bearer(client) -> None:
    r = client.get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert body.get("status") == "ok"
    assert "vectors" in body


def test_api_bearer_blocks_dashboard(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("INSIDE_ME_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("INSIDE_ME_API_BEARER_TOKEN", "secret")
    c = TestClient(create_app())
    assert c.get("/api/dashboard").status_code == 401
    r = c.get("/api/dashboard", headers={"Authorization": "Bearer secret"})
    assert r.status_code == 200
    assert c.get("/api/metrics").status_code == 200


def test_import_preview(client) -> None:
    raw = b"[2024-01-01 12:00:00] hello from smoke test\n"
    r = client.post(
        "/api/import/preview",
        files={"file": ("t.txt", io.BytesIO(raw), "text/plain")},
    )
    assert r.status_code == 200
    data = r.json()
    assert data.get("total_parsed", 0) >= 1
    assert "preview" in data


def test_memory_item_patch_validation(client) -> None:
    r = client.patch("/api/memory/item", json={"id": "any"})
    assert r.status_code == 422


def test_api_metrics(client) -> None:
    r = client.get("/api/metrics")
    assert r.status_code == 200
    assert "inside_me" in r.text


def test_memory_item_patch_not_found(client) -> None:
    r = client.patch(
        "/api/memory/item",
        json={"id": "missing-id-xxxxxxxx", "sender": "x"},
    )
    assert r.status_code == 404


def test_import_job_completes(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("INSIDE_ME_DATA_DIR", str(tmp_path))
    c = TestClient(create_app())
    raw = b"[2024-01-01 12:00:00] user: hello job import line\n"
    r = c.post("/api/import/job", files={"file": ("smoke_job.txt", io.BytesIO(raw), "text/plain")})
    assert r.status_code == 200
    jid = r.json().get("job_id")
    assert jid
    body: dict = {}
    status = "queued"
    for _ in range(100):
        s = c.get(f"/api/import/job/{jid}")
        assert s.status_code == 200
        body = s.json()
        status = str(body.get("status", ""))
        if status in ("done", "error", "cancelled"):
            break
        time.sleep(0.02)
    assert status == "done"
    assert (body.get("imported") or 0) >= 1
