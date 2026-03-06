import asyncio
import importlib
import sqlite3
from pathlib import Path

import httpx
import pytest

import app.config as config_module
import app.db as db_module
import app.main as main_module


def _table_columns(connection: sqlite3.Connection, table_name: str) -> list[str]:
    rows = connection.execute(f"PRAGMA table_info({table_name});").fetchall()
    return [row["name"] for row in rows]


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


def test_init_db_creates_expected_schema(monkeypatch, tmp_path) -> None:
    database_path = tmp_path / "schema" / "blindup.db"
    monkeypatch.setattr(
        db_module,
        "settings",
        config_module.Settings(database_path=database_path),
    )

    db_module.init_db()

    with db_module.get_connection() as connection:
        tables = {
            row["name"]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table';"
            ).fetchall()
        }
        indexes = {
            row["name"]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'index';"
            ).fetchall()
        }

        assert {
            "songs",
            "blindtests",
            "blindtest_tags",
            "blindtest_tag_links",
            "blindtest_songs",
        }.issubset(tables)

        assert _table_columns(connection, "songs") == [
            "id",
            "file_hash",
            "file_path",
            "duration_sec",
            "title",
            "artist",
            "album",
            "year",
            "genre",
            "cover_path",
            "created_at",
            "updated_at",
        ]
        assert _table_columns(connection, "blindtests") == [
            "id",
            "title",
            "background_image",
            "game_mode",
            "pre_play_delay_sec",
            "auto_enabled_default",
            "hints_enabled_default",
            "answer_timer_enabled",
            "answer_duration_sec",
            "round3_step_durations",
            "round3_step_gap_sec",
            "round3_progression_mode",
            "created_at",
            "updated_at",
        ]
        assert _table_columns(connection, "blindtest_tags") == ["id", "name"]
        assert _table_columns(connection, "blindtest_tag_links") == [
            "blindtest_id",
            "tag_id",
        ]
        assert _table_columns(connection, "blindtest_songs") == [
            "id",
            "blindtest_id",
            "song_id",
            "order_index",
            "start_sec",
            "duration_sec",
            "override_title",
            "override_artist",
            "override_album",
            "override_year",
            "override_genre",
            "override_cover",
            "custom_hint",
        ]

        assert "idx_song_hash" in indexes
        assert "idx_song_path" in indexes
        assert "idx_blindtest_song_order" in indexes


def test_schema_constraints_are_enforced(monkeypatch, tmp_path) -> None:
    database_path = tmp_path / "constraints" / "blindup.db"
    monkeypatch.setattr(
        db_module,
        "settings",
        config_module.Settings(database_path=database_path),
    )

    db_module.init_db()

    with db_module.get_connection() as connection:
        connection.execute(
            """
            INSERT INTO songs (file_hash, file_path)
            VALUES (?, ?);
            """,
            ("hash-1", "/music/song-1.mp3"),
        )
        connection.execute(
            """
            INSERT INTO blindtests (title)
            VALUES (?);
            """,
            ("Blindtest demo",),
        )
        connection.execute(
            """
            INSERT INTO blindtest_tags (name)
            VALUES (?);
            """,
            ("Rock",),
        )

        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                """
                INSERT INTO songs (file_hash, file_path)
                VALUES (?, ?);
                """,
                ("hash-1", "/music/song-2.mp3"),
            )

        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                """
                INSERT INTO blindtest_tags (name)
                VALUES (?);
                """,
                ("Rock",),
            )

        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                """
                INSERT INTO blindtest_songs (blindtest_id, song_id)
                VALUES (?, ?);
                """,
                (1, 999),
            )

        connection.execute(
            """
            INSERT INTO blindtest_songs (blindtest_id, song_id, order_index)
            VALUES (?, ?, ?);
            """,
            (1, 1, 0),
        )
        connection.execute(
            """
            INSERT INTO blindtest_tag_links (blindtest_id, tag_id)
            VALUES (?, ?);
            """,
            (1, 1),
        )

        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                """
                INSERT INTO blindtest_tag_links (blindtest_id, tag_id)
                VALUES (?, ?);
                """,
                (1, 1),
            )


def test_fastapi_routes_serve_expected_responses() -> None:
    async def get_health_response() -> httpx.Response:
        transport = httpx.ASGITransport(app=main_module.app)
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://testserver",
        ) as client:
            return await client.get("/health")

    async def run_startup() -> None:
        async with main_module.lifespan(main_module.app):
            return None

    asyncio.run(run_startup())
    root_response = asyncio.run(main_module.root())
    health_payload = asyncio.run(main_module.health())
    health_response = asyncio.run(get_health_response())
    static_index = main_module.settings.static_dir / "index.html"
    static_styles = main_module.settings.static_dir / "styles.css"
    static_script = main_module.settings.static_dir / "app.js"

    assert main_module.app.title == main_module.settings.project_name
    assert any(route.name == "static" for route in main_module.app.routes)
    assert root_response.status_code == 307
    assert root_response.headers["location"] == "/static/index.html"
    assert health_payload == {"status": "ok"}
    assert health_response.status_code == 200
    assert health_response.json() == {"status": "ok"}
    assert static_index.exists()
    assert "BlindUp" in static_index.read_text(encoding="utf-8")
    assert static_styles.exists()
    assert "background" in static_styles.read_text(encoding="utf-8")
    assert static_script.exists()
    assert "blindUpReady" in static_script.read_text(encoding="utf-8")
