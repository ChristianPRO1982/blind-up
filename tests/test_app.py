import asyncio
import importlib
import sqlite3
from pathlib import Path

import httpx

import app.config as config_module
import app.db as db_module
import app.main as main_module


def test_config_defaults(monkeypatch) -> None:
    monkeypatch.delenv("BLINDUP_DB_PATH", raising=False)

    reloaded_config = importlib.reload(config_module)

    assert reloaded_config.BASE_DIR == Path(__file__).resolve().parents[1]
    assert reloaded_config.settings.project_name == "BlindUp"
    assert (
        reloaded_config.settings.database_path
        == reloaded_config.BASE_DIR / "blindup.db"
    )
    assert (
        reloaded_config.settings.static_dir
        == reloaded_config.BASE_DIR / "app" / "static"
    )


def test_config_uses_environment_override(monkeypatch, tmp_path) -> None:
    custom_database_path = tmp_path / "data" / "blindup.db"
    monkeypatch.setenv("BLINDUP_DB_PATH", str(custom_database_path))

    reloaded_config = importlib.reload(config_module)

    assert reloaded_config.settings.database_path == custom_database_path

    monkeypatch.delenv("BLINDUP_DB_PATH", raising=False)
    importlib.reload(config_module)


def test_get_connection_creates_database_and_enables_foreign_keys(
    monkeypatch,
    tmp_path,
) -> None:
    database_path = tmp_path / "nested" / "blindup.db"
    monkeypatch.setattr(
        db_module,
        "settings",
        config_module.Settings(database_path=database_path),
    )

    connection = db_module.get_connection()
    try:
        foreign_keys_enabled = connection.execute("PRAGMA foreign_keys;").fetchone()[0]
        assert foreign_keys_enabled == 1
        assert connection.row_factory is sqlite3.Row
    finally:
        connection.close()

    assert database_path.exists()


def test_init_db_creates_database_file(monkeypatch, tmp_path) -> None:
    database_path = tmp_path / "init" / "blindup.db"
    monkeypatch.setattr(
        db_module,
        "settings",
        config_module.Settings(database_path=database_path),
    )

    db_module.init_db()

    assert database_path.exists()


def test_fastapi_routes_serve_expected_responses() -> None:
    async def get_health_response() -> httpx.Response:
        transport = httpx.ASGITransport(app=main_module.app)
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://testserver",
        ) as client:
            return await client.get("/health")

    root_response = asyncio.run(main_module.root())
    health_payload = asyncio.run(main_module.health())
    health_response = asyncio.run(get_health_response())
    static_index = main_module.settings.static_dir / "index.html"

    assert main_module.app.title == main_module.settings.project_name
    assert any(route.name == "static" for route in main_module.app.routes)
    assert root_response.status_code == 307
    assert root_response.headers["location"] == "/static/index.html"
    assert health_payload == {"status": "ok"}
    assert health_response.status_code == 200
    assert health_response.json() == {"status": "ok"}
    assert static_index.exists()
    assert "BlindUp" in static_index.read_text(encoding="utf-8")
