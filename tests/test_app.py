import asyncio
import importlib
import sqlite3
from pathlib import Path

import httpx
import pytest

import app.config as config_module
import app.db as db_module
import app.main as main_module
from app.services.library_scan_service import ScanSummary


def _table_columns(connection: sqlite3.Connection, table_name: str) -> list[str]:
    rows = connection.execute(f"PRAGMA table_info({table_name});").fetchall()
    return [row["name"] for row in rows]


def test_config_defaults(monkeypatch) -> None:
    monkeypatch.delenv("BLINDUP_DB_PATH", raising=False)
    monkeypatch.delenv("BLINDUP_STORAGE_DIR", raising=False)
    monkeypatch.delenv("BLINDUP_COVERS_DIR", raising=False)

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
    assert reloaded_config.settings.storage_dir == reloaded_config.BASE_DIR / "storage"
    assert (
        reloaded_config.settings.covers_dir
        == reloaded_config.BASE_DIR / "storage" / "covers"
    )


def test_config_uses_environment_override(monkeypatch, tmp_path) -> None:
    custom_database_path = tmp_path / "data" / "blindup.db"
    custom_storage_dir = tmp_path / "data" / "storage"
    custom_covers_dir = custom_storage_dir / "custom-covers"
    monkeypatch.setenv("BLINDUP_DB_PATH", str(custom_database_path))
    monkeypatch.setenv("BLINDUP_STORAGE_DIR", str(custom_storage_dir))
    monkeypatch.setenv("BLINDUP_COVERS_DIR", str(custom_covers_dir))

    reloaded_config = importlib.reload(config_module)

    assert reloaded_config.settings.database_path == custom_database_path
    assert reloaded_config.settings.storage_dir == custom_storage_dir
    assert reloaded_config.settings.covers_dir == custom_covers_dir

    monkeypatch.delenv("BLINDUP_DB_PATH", raising=False)
    monkeypatch.delenv("BLINDUP_STORAGE_DIR", raising=False)
    monkeypatch.delenv("BLINDUP_COVERS_DIR", raising=False)
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


def test_blindtest_song_migration_helpers_handle_missing_table() -> None:
    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    try:
        assert db_module._blindtest_songs_needs_migration(connection) is False
        db_module._migrate_blindtest_songs(connection)
    finally:
        connection.close()


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
            "slot_status",
            "start_sec",
            "duration_sec",
            "source_title",
            "source_artist",
            "source_album",
            "source_year",
            "source_genre",
            "source_cover",
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


def test_init_db_migrates_legacy_blindtest_songs_table(monkeypatch, tmp_path) -> None:
    database_path = tmp_path / "legacy" / "blindup.db"
    monkeypatch.setattr(
        db_module,
        "settings",
        config_module.Settings(database_path=database_path),
    )

    database_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(database_path)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON;")
    connection.executescript(
        """
        CREATE TABLE songs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_hash TEXT UNIQUE NOT NULL,
            file_path TEXT NOT NULL,
            duration_sec REAL,
            title TEXT,
            artist TEXT,
            album TEXT,
            year INTEGER,
            genre TEXT,
            cover_path TEXT,
            created_at TEXT,
            updated_at TEXT
        );

        CREATE TABLE blindtests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            background_image TEXT,
            game_mode TEXT,
            pre_play_delay_sec REAL,
            auto_enabled_default INTEGER,
            hints_enabled_default INTEGER,
            answer_timer_enabled INTEGER,
            answer_duration_sec REAL,
            round3_step_durations TEXT,
            round3_step_gap_sec REAL,
            round3_progression_mode TEXT,
            created_at TEXT,
            updated_at TEXT
        );

        CREATE TABLE blindtest_songs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            blindtest_id INTEGER NOT NULL,
            song_id INTEGER NOT NULL,
            order_index INTEGER,
            start_sec REAL,
            duration_sec REAL,
            override_title TEXT,
            override_artist TEXT,
            override_album TEXT,
            override_year INTEGER,
            override_genre TEXT,
            override_cover TEXT,
            custom_hint TEXT,
            FOREIGN KEY (blindtest_id) REFERENCES blindtests(id),
            FOREIGN KEY (song_id) REFERENCES songs(id)
        );

        INSERT INTO songs (id, file_hash, file_path, title, artist)
        VALUES (1, 'hash-1', '/music/song-1.mp3', 'Song 1', 'Artist 1');

        INSERT INTO blindtests (id, title)
        VALUES (1, 'Legacy');

        INSERT INTO blindtest_songs (
            id,
            blindtest_id,
            song_id,
            order_index,
            start_sec,
            duration_sec,
            custom_hint
        )
        VALUES (1, 1, 1, 0, 12, 3.5, 'legacy');
        """
    )
    connection.close()

    db_module.init_db()

    with db_module.get_connection() as migrated:
        columns = _table_columns(migrated, "blindtest_songs")
        row = migrated.execute(
            """
            SELECT song_id, slot_status, source_title, source_artist, custom_hint
            FROM blindtest_songs
            WHERE id = 1;
            """
        ).fetchone()

    assert columns == [
        "id",
        "blindtest_id",
        "song_id",
        "order_index",
        "slot_status",
        "start_sec",
        "duration_sec",
        "source_title",
        "source_artist",
        "source_album",
        "source_year",
        "source_genre",
        "source_cover",
        "override_title",
        "override_artist",
        "override_album",
        "override_year",
        "override_genre",
        "override_cover",
        "custom_hint",
    ]
    assert dict(row) == {
        "song_id": 1,
        "slot_status": "ok",
        "source_title": "Song 1",
        "source_artist": "Artist 1",
        "custom_hint": "legacy",
    }


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
            INSERT INTO blindtest_songs (
                blindtest_id,
                song_id,
                order_index,
                slot_status
            )
            VALUES (?, ?, ?, ?);
            """,
            (1, 1, 0, "ok"),
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

    async def post_scan_response() -> httpx.Response:
        transport = httpx.ASGITransport(app=main_module.app)
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://testserver",
        ) as client:
            return await client.post(
                "/api/library/scan",
                json={"root_path": "/music"},
            )

    async def get_songs_response() -> httpx.Response:
        transport = httpx.ASGITransport(app=main_module.app)
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://testserver",
        ) as client:
            return await client.get("/api/songs")

    async def get_blindtests_response() -> httpx.Response:
        transport = httpx.ASGITransport(app=main_module.app)
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://testserver",
        ) as client:
            return await client.get("/api/blindtests")

    async def get_blindtest_response() -> httpx.Response:
        transport = httpx.ASGITransport(app=main_module.app)
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://testserver",
        ) as client:
            return await client.get("/api/blindtest/1")

    async def post_blindtest_response() -> httpx.Response:
        transport = httpx.ASGITransport(app=main_module.app)
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://testserver",
        ) as client:
            return await client.post(
                "/api/blindtest",
                json={
                    "title": "Friday night",
                    "background_image": "/backgrounds/friday-night.jpg",
                    "game_mode": "blindup",
                    "pre_play_delay_sec": 1.5,
                    "auto_enabled_default": True,
                    "hints_enabled_default": False,
                    "answer_timer_enabled": True,
                    "answer_duration_sec": 12,
                    "round3_step_durations": "0.5,1,2",
                    "round3_step_gap_sec": 4,
                    "round3_progression_mode": "continuous",
                    "songs": [
                        {
                            "song_id": 1,
                            "order_index": 0,
                            "start_sec": 45,
                            "duration_sec": 3.5,
                            "override_title": "Opening song",
                            "override_artist": None,
                            "override_album": None,
                            "override_year": 1999,
                            "override_genre": None,
                            "override_cover": None,
                            "custom_hint": "Final chorus",
                        }
                    ],
                },
            )

    async def run_startup() -> None:
        async with main_module.lifespan(main_module.app):
            return None

    asyncio.run(run_startup())
    original_scan_library = main_module.scan_library
    original_list_songs = main_module.song_repository.list_songs
    original_normalize_song_media_paths = (
        main_module.song_repository.normalize_song_media_paths
    )
    original_list_blindtests = main_module.blindtest_repository.list_blindtests
    original_get_blindtest = main_module.blindtest_repository.get_blindtest
    original_normalize_blindtest_media = (
        main_module.blindtest_repository.normalize_blindtest_media
    )
    original_validate_blindtest_links = (
        main_module.blindtest_repository.validate_blindtest_links
    )
    original_save_blindtest = main_module.blindtest_repository.save_blindtest
    main_module.scan_library = lambda _: ScanSummary(
        root_path="/music",
        scanned_files=1,
        added=1,
        updated=0,
        removed=0,
        broken_slots=0,
        skipped=0,
        errors=0,
    )
    main_module.song_repository.list_songs = lambda: [
        {
            "id": 1,
            "title": "Song 1",
            "artist": "Artist 1",
            "album": "Album 1",
            "year": 2001,
            "genre": "Rock",
            "cover_path": "/covers/song-1.jpg",
            "duration_sec": 10.0,
        }
    ]
    main_module.song_repository.normalize_song_media_paths = lambda: 0
    main_module.blindtest_repository.list_blindtests = lambda: [
        {
            "id": 1,
            "title": "Stored blindtest",
            "updated_at": "2026-03-06T12:00:00+00:00",
        }
    ]
    main_module.blindtest_repository.get_blindtest = lambda _: {
        "id": 1,
        "title": "Stored blindtest",
        "background_image": "/backgrounds/stored.jpg",
        "game_mode": "blind_test",
        "pre_play_delay_sec": 0.0,
        "auto_enabled_default": 0,
        "hints_enabled_default": 1,
        "answer_timer_enabled": 0,
        "answer_duration_sec": 10.0,
        "round3_step_durations": "0.5,1,1.5,2,3,4,5",
        "round3_step_gap_sec": 3.0,
        "round3_progression_mode": "fixed_start",
        "songs": [],
    }
    main_module.blindtest_repository.normalize_blindtest_media = lambda _: 0
    main_module.blindtest_repository.validate_blindtest_links = lambda _: {
        "validated_slots": 0,
        "missing_slots": 0,
    }
    main_module.blindtest_repository.save_blindtest = lambda record: {
        "id": 2,
        "title": record.title,
        "background_image": record.background_image,
        "game_mode": record.game_mode,
        "pre_play_delay_sec": record.pre_play_delay_sec,
        "auto_enabled_default": int(record.auto_enabled_default),
        "hints_enabled_default": int(record.hints_enabled_default),
        "answer_timer_enabled": int(record.answer_timer_enabled),
        "answer_duration_sec": record.answer_duration_sec,
        "round3_step_durations": record.round3_step_durations,
        "round3_step_gap_sec": record.round3_step_gap_sec,
        "round3_progression_mode": record.round3_progression_mode,
        "songs": [
            {
                "id": 1,
                "blindtest_id": 2,
                "song_id": song.song_id,
                "order_index": song.order_index,
                "slot_status": song.slot_status,
                "start_sec": song.start_sec,
                "duration_sec": song.duration_sec,
                "source_title": song.source_title,
                "source_artist": song.source_artist,
                "source_album": song.source_album,
                "source_year": song.source_year,
                "source_genre": song.source_genre,
                "source_cover": song.source_cover,
                "override_title": song.override_title,
                "override_artist": song.override_artist,
                "override_album": song.override_album,
                "override_year": song.override_year,
                "override_genre": song.override_genre,
                "override_cover": song.override_cover,
                "custom_hint": song.custom_hint,
            }
            for song in record.songs
        ],
    }
    root_response = asyncio.run(main_module.root())
    health_payload = asyncio.run(main_module.health())
    health_response = asyncio.run(get_health_response())
    scan_response = asyncio.run(post_scan_response())
    songs_response = asyncio.run(get_songs_response())
    blindtests_response = asyncio.run(get_blindtests_response())
    blindtest_response = asyncio.run(get_blindtest_response())
    save_blindtest_response = asyncio.run(post_blindtest_response())
    static_index = main_module.settings.static_dir / "index.html"
    static_styles = main_module.settings.static_dir / "styles.css"
    static_script = main_module.settings.static_dir / "app.js"

    try:
        assert main_module.app.title == main_module.settings.project_name
        assert any(route.name == "static" for route in main_module.app.routes)
        assert any(route.name == "media" for route in main_module.app.routes)
        assert any(
            route.path == "/api/library/scan" for route in main_module.app.routes
        )
        assert any(route.path == "/api/blindtests" for route in main_module.app.routes)
        assert any(
            route.path == "/api/blindtest/{blindtest_id}"
            for route in main_module.app.routes
        )
        assert root_response.status_code == 307
        assert root_response.headers["location"] == "/static/index.html"
        assert health_payload == {"status": "ok"}
        assert health_response.status_code == 200
        assert health_response.json() == {"status": "ok"}
        assert scan_response.status_code == 200
        assert scan_response.json() == {
            "status": "ok",
            "summary": {
                "root_path": "/music",
                "scanned_files": 1,
                "added": 1,
                "updated": 0,
                "removed": 0,
                "broken_slots": 0,
                "skipped": 0,
                "errors": 0,
            },
        }
        assert songs_response.status_code == 200
        assert songs_response.json() == {
            "songs": [
                {
                    "id": 1,
                    "title": "Song 1",
                    "artist": "Artist 1",
                    "album": "Album 1",
                    "year": 2001,
                    "genre": "Rock",
                    "cover_path": "/covers/song-1.jpg",
                    "duration_sec": 10.0,
                }
            ]
        }
        assert blindtests_response.status_code == 200
        assert blindtests_response.json() == {
            "blindtests": [
                {
                    "id": 1,
                    "title": "Stored blindtest",
                    "updated_at": "2026-03-06T12:00:00+00:00",
                }
            ]
        }
        assert blindtest_response.status_code == 200
        assert blindtest_response.json() == {
            "blindtest": {
                "id": 1,
                "title": "Stored blindtest",
                "background_image": "/backgrounds/stored.jpg",
                "game_mode": "blind_test",
                "pre_play_delay_sec": 0.0,
                "auto_enabled_default": 0,
                "hints_enabled_default": 1,
                "answer_timer_enabled": 0,
                "answer_duration_sec": 10.0,
                "round3_step_durations": "0.5,1,1.5,2,3,4,5",
                "round3_step_gap_sec": 3.0,
                "round3_progression_mode": "fixed_start",
                "songs": [],
            }
        }
        assert save_blindtest_response.status_code == 200
        assert save_blindtest_response.json() == {
            "status": "ok",
            "blindtest": {
                "id": 2,
                "title": "Friday night",
                "background_image": "/backgrounds/friday-night.jpg",
                "game_mode": "blindup",
                "pre_play_delay_sec": 1.5,
                "auto_enabled_default": 1,
                "hints_enabled_default": 0,
                "answer_timer_enabled": 1,
                "answer_duration_sec": 12.0,
                "round3_step_durations": "0.5,1,2",
                "round3_step_gap_sec": 4.0,
                "round3_progression_mode": "continuous",
                "songs": [
                    {
                        "id": 1,
                        "blindtest_id": 2,
                        "song_id": 1,
                        "order_index": 0,
                        "slot_status": "ok",
                        "start_sec": 45.0,
                        "duration_sec": 3.5,
                        "source_title": None,
                        "source_artist": None,
                        "source_album": None,
                        "source_year": None,
                        "source_genre": None,
                        "source_cover": None,
                        "override_title": "Opening song",
                        "override_artist": None,
                        "override_album": None,
                        "override_year": 1999,
                        "override_genre": None,
                        "override_cover": None,
                        "custom_hint": "Final chorus",
                    }
                ],
            },
        }
        assert static_index.exists()
        index_text = static_index.read_text(encoding="utf-8")
        assert "BlindUp" in index_text
        assert "Home panel" in index_text
        assert "New blindtest" in index_text
        assert "Blindtest editor" in index_text
        assert "Blindtest player" in index_text
        assert "Reset selection" in index_text
        assert "Library" in index_text
        assert static_styles.exists()
        styles_text = static_styles.read_text(encoding="utf-8")
        assert "background" in styles_text
        assert ".waveform-region" in styles_text
        assert ".song-card.active" in styles_text
        assert ".player-layout" in styles_text
        assert ".player-stage" in styles_text
        assert static_script.exists()
        script_text = static_script.read_text(encoding="utf-8")
        assert "blindUpReady" in script_text
        assert "openBlindtest" in script_text
        assert "showHomeView" in script_text
        assert "saveBlindtest" in script_text
        assert "replaceSlotSong" in script_text
        assert "launchPlayer" in script_text
        assert "Round 2 — Reverse" in script_text
        assert "Round 3 — Escalation" in script_text
        assert "Schrouunntch" in script_text
    finally:
        main_module.scan_library = original_scan_library
        main_module.song_repository.list_songs = original_list_songs
        main_module.song_repository.normalize_song_media_paths = (
            original_normalize_song_media_paths
        )
        main_module.blindtest_repository.list_blindtests = original_list_blindtests
        main_module.blindtest_repository.get_blindtest = original_get_blindtest
        main_module.blindtest_repository.normalize_blindtest_media = (
            original_normalize_blindtest_media
        )
        main_module.blindtest_repository.validate_blindtest_links = (
            original_validate_blindtest_links
        )
        main_module.blindtest_repository.save_blindtest = original_save_blindtest


def test_library_scan_route_returns_400_for_invalid_root(monkeypatch) -> None:
    async def post_scan_response() -> httpx.Response:
        transport = httpx.ASGITransport(app=main_module.app)
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://testserver",
        ) as client:
            return await client.post(
                "/api/library/scan",
                json={"root_path": "/missing"},
            )

    def raise_missing(_: str) -> ScanSummary:
        raise FileNotFoundError("/missing")

    monkeypatch.setattr(main_module, "scan_library", raise_missing)

    response = asyncio.run(post_scan_response())

    assert response.status_code == 400
    assert response.json() == {"detail": "Invalid root path: /missing"}


def test_blindtest_route_returns_404_for_missing_blindtest(monkeypatch) -> None:
    async def get_blindtest_response() -> httpx.Response:
        transport = httpx.ASGITransport(app=main_module.app)
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://testserver",
        ) as client:
            return await client.get("/api/blindtest/999")

    monkeypatch.setattr(
        main_module.song_repository,
        "normalize_song_media_paths",
        lambda: 0,
    )
    monkeypatch.setattr(
        main_module.blindtest_repository,
        "get_blindtest",
        lambda _: None,
    )

    response = asyncio.run(get_blindtest_response())

    assert response.status_code == 404
    assert response.json() == {"detail": "Blindtest not found"}


def test_audio_route_serves_existing_file(monkeypatch, tmp_path) -> None:
    audio_path = tmp_path / "song.mp3"
    audio_path.write_bytes(b"ID3")

    async def get_audio_response() -> httpx.Response:
        transport = httpx.ASGITransport(app=main_module.app)
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://testserver",
        ) as client:
            return await client.get("/api/audio/1")

    monkeypatch.setattr(
        main_module.song_repository,
        "get_song_by_id",
        lambda song_id: {"id": song_id, "file_path": str(audio_path)},
    )

    response = asyncio.run(get_audio_response())

    assert response.status_code == 200
    assert response.content == b"ID3"


def test_audio_route_returns_404_for_missing_song(monkeypatch) -> None:
    async def get_audio_response() -> httpx.Response:
        transport = httpx.ASGITransport(app=main_module.app)
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://testserver",
        ) as client:
            return await client.get("/api/audio/999")

    monkeypatch.setattr(main_module.song_repository, "get_song_by_id", lambda _: None)

    response = asyncio.run(get_audio_response())

    assert response.status_code == 404
    assert response.json() == {"detail": "Song not found"}


def test_audio_route_returns_404_for_missing_file(monkeypatch, tmp_path) -> None:
    missing_audio = tmp_path / "missing.mp3"

    async def get_audio_response() -> httpx.Response:
        transport = httpx.ASGITransport(app=main_module.app)
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://testserver",
        ) as client:
            return await client.get("/api/audio/1")

    monkeypatch.setattr(
        main_module.song_repository,
        "get_song_by_id",
        lambda song_id: {"id": song_id, "file_path": str(missing_audio)},
    )

    response = asyncio.run(get_audio_response())

    assert response.status_code == 404
    assert response.json() == {"detail": "Audio unavailable"}
