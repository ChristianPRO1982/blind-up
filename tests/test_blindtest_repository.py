import sqlite3

import app.config as config_module
import app.db as db_module
from app.repositories import blindtest_repository
from app.services import media_path_service


def test_blindtest_timestamp_returns_iso_string() -> None:
    assert "T" in blindtest_repository._timestamp()


def test_list_blindtests_returns_empty_when_database_is_empty(
    monkeypatch,
    tmp_path,
) -> None:
    database_path = tmp_path / "blindup.db"
    monkeypatch.setattr(
        db_module,
        "settings",
        config_module.Settings(database_path=database_path),
    )

    db_module.init_db()

    assert blindtest_repository.list_blindtests() == []


def test_save_blindtest_inserts_then_updates(monkeypatch, tmp_path) -> None:
    database_path = tmp_path / "blindup.db"
    monkeypatch.setattr(
        db_module,
        "settings",
        config_module.Settings(database_path=database_path),
    )
    timestamps = iter(["2026-03-06T10:00:00+00:00", "2026-03-06T10:05:00+00:00"])
    monkeypatch.setattr(blindtest_repository, "_timestamp", lambda: next(timestamps))

    db_module.init_db()
    with db_module.get_connection() as connection:
        connection.execute(
            """
            INSERT INTO songs (file_hash, file_path, title, artist)
            VALUES (?, ?, ?, ?);
            """,
            ("hash-1", "/music/song-1.mp3", "Song 1", "Artist 1"),
        )
        connection.execute(
            """
            INSERT INTO songs (file_hash, file_path, title, artist)
            VALUES (?, ?, ?, ?);
            """,
            ("hash-2", "/music/song-2.mp3", "Song 2", "Artist 2"),
        )

    inserted = blindtest_repository.save_blindtest(
        blindtest_repository.BlindtestRecord(
            title="Round one",
            background_image="/backgrounds/round-one.jpg",
            game_mode="blindup",
            pre_play_delay_sec=2.5,
            auto_enabled_default=True,
            hints_enabled_default=False,
            answer_timer_enabled=True,
            answer_duration_sec=15,
            round3_step_durations="0.5,1,2",
            round3_step_gap_sec=4,
            round3_progression_mode="continuous",
            songs=[
                blindtest_repository.BlindtestSongRecord(
                    song_id=1,
                    order_index=0,
                    start_sec=45,
                    duration_sec=3.5,
                    override_title="Opening",
                    override_year=1999,
                    custom_hint="chorus",
                )
            ],
        )
    )

    updated = blindtest_repository.save_blindtest(
        blindtest_repository.BlindtestRecord(
            id=int(inserted["id"]),
            title="Round two",
            background_image="/backgrounds/round-two.jpg",
            game_mode="blind_test",
            pre_play_delay_sec=1,
            auto_enabled_default=False,
            hints_enabled_default=True,
            answer_timer_enabled=False,
            answer_duration_sec=8,
            round3_step_durations="1,2,3",
            round3_step_gap_sec=2,
            round3_progression_mode="fixed_start",
            songs=[
                blindtest_repository.BlindtestSongRecord(
                    song_id=2,
                    order_index=0,
                    start_sec=10,
                    duration_sec=1.5,
                    override_artist="Override artist",
                    override_album="Override album",
                    override_genre="Pop",
                    override_background="/covers/override.jpg",
                )
            ],
        )
    )

    assert inserted["title"] == "Round one"
    assert inserted["background_image"] == "/backgrounds/round-one.jpg"
    assert inserted["created_at"] == "2026-03-06T10:00:00+00:00"
    assert inserted["updated_at"] == "2026-03-06T10:00:00+00:00"
    assert inserted["songs"] == [
        {
            "id": 1,
            "blindtest_id": inserted["id"],
            "song_id": 1,
            "order_index": 0,
            "slot_status": "ok",
            "start_sec": 45.0,
            "duration_sec": 3.5,
            "source_title": "Song 1",
            "source_artist": "Artist 1",
            "source_album": None,
            "source_year": None,
            "source_genre": None,
            "source_background": None,
            "override_title": "Opening",
            "override_artist": None,
            "override_album": None,
            "override_year": 1999,
            "override_genre": None,
            "override_background": None,
            "custom_hint": "chorus",
        }
    ]
    assert updated["title"] == "Round two"
    assert updated["background_image"] == "/backgrounds/round-two.jpg"
    assert updated["created_at"] == "2026-03-06T10:00:00+00:00"
    assert updated["updated_at"] == "2026-03-06T10:05:00+00:00"
    assert updated["songs"] == [
        {
            "id": 2,
            "blindtest_id": inserted["id"],
            "song_id": 2,
            "order_index": 0,
            "slot_status": "ok",
            "start_sec": 10.0,
            "duration_sec": 1.5,
            "source_title": "Song 2",
            "source_artist": "Artist 2",
            "source_album": None,
            "source_year": None,
            "source_genre": None,
            "source_background": None,
            "override_title": None,
            "override_artist": "Override artist",
            "override_album": "Override album",
            "override_year": None,
            "override_genre": "Pop",
            "override_background": "/covers/override.jpg",
            "custom_hint": None,
        }
    ]
    assert blindtest_repository.get_blindtest(int(inserted["id"])) == updated
    assert blindtest_repository.get_blindtest(9999) is None


def test_list_blindtests_orders_by_last_update_desc(monkeypatch, tmp_path) -> None:
    database_path = tmp_path / "blindup.db"
    monkeypatch.setattr(
        db_module,
        "settings",
        config_module.Settings(database_path=database_path),
    )

    db_module.init_db()
    with db_module.get_connection() as connection:
        connection.execute(
            """
            INSERT INTO blindtests (id, title, updated_at)
            VALUES (?, ?, ?);
            """,
            (1, "Older", "2026-03-06T10:00:00+00:00"),
        )
        connection.execute(
            """
            INSERT INTO blindtests (id, title, updated_at)
            VALUES (?, ?, ?);
            """,
            (2, "Newer", "2026-03-06T11:00:00+00:00"),
        )
        connection.execute(
            """
            INSERT INTO blindtest_songs (blindtest_id, song_id, order_index)
            VALUES (?, ?, ?);
            """,
            (2, None, 0),
        )
        connection.execute(
            """
            INSERT INTO blindtest_songs (blindtest_id, song_id, order_index)
            VALUES (?, ?, ?);
            """,
            (2, None, 1),
        )

    assert blindtest_repository.list_blindtests() == [
        {
            "id": 2,
            "title": "Newer",
            "updated_at": "2026-03-06T11:00:00+00:00",
            "songs_count": 2,
        },
        {
            "id": 1,
            "title": "Older",
            "updated_at": "2026-03-06T10:00:00+00:00",
            "songs_count": 0,
        },
    ]


def test_list_blindtests_impacted_by_song_ids_returns_distinct_blindtests(
    monkeypatch,
    tmp_path,
) -> None:
    database_path = tmp_path / "blindup.db"
    monkeypatch.setattr(
        db_module,
        "settings",
        config_module.Settings(database_path=database_path),
    )

    db_module.init_db()
    with db_module.get_connection() as connection:
        connection.execute(
            """
            INSERT INTO songs (id, file_hash, file_path, title)
            VALUES (?, ?, ?, ?);
            """,
            (1, "hash-1", str(tmp_path / "a.mp3"), "Song A"),
        )
        connection.execute(
            """
            INSERT INTO songs (id, file_hash, file_path, title)
            VALUES (?, ?, ?, ?);
            """,
            (2, "hash-2", str(tmp_path / "b.mp3"), "Song B"),
        )
        connection.execute(
            """
            INSERT INTO blindtests (id, title, updated_at)
            VALUES (?, ?, ?);
            """,
            (1, "Older", "2026-03-06T10:00:00+00:00"),
        )
        connection.execute(
            """
            INSERT INTO blindtests (id, title, updated_at)
            VALUES (?, ?, ?);
            """,
            (2, "Newer", "2026-03-06T11:00:00+00:00"),
        )
        connection.execute(
            """
            INSERT INTO blindtest_songs (
                blindtest_id, song_id, order_index, slot_status
            )
            VALUES (?, ?, ?, ?);
            """,
            (1, 1, 0, "ok"),
        )
        connection.execute(
            """
            INSERT INTO blindtest_songs (
                blindtest_id, song_id, order_index, slot_status
            )
            VALUES (?, ?, ?, ?);
            """,
            (2, 1, 0, "ok"),
        )
        connection.execute(
            """
            INSERT INTO blindtest_songs (
                blindtest_id, song_id, order_index, slot_status
            )
            VALUES (?, ?, ?, ?);
            """,
            (2, 2, 1, "ok"),
        )

    assert blindtest_repository.list_blindtests_impacted_by_song_ids([1, 2]) == [
        {"id": 2, "title": "Newer"},
        {"id": 1, "title": "Older"},
    ]
    assert blindtest_repository.list_blindtests_impacted_by_song_ids([]) == []


def test_delete_blindtest_removes_slots_and_tag_links(monkeypatch, tmp_path) -> None:
    database_path = tmp_path / "blindup.db"
    monkeypatch.setattr(
        db_module,
        "settings",
        config_module.Settings(database_path=database_path),
    )

    db_module.init_db()
    with db_module.get_connection() as connection:
        connection.execute(
            """
            INSERT INTO blindtests (id, title, updated_at)
            VALUES (?, ?, ?);
            """,
            (1, "Delete me", "2026-03-06T11:00:00+00:00"),
        )
        connection.execute(
            """
            INSERT INTO blindtest_tags (id, name)
            VALUES (?, ?);
            """,
            (1, "Party"),
        )
        connection.execute(
            """
            INSERT INTO blindtest_tag_links (blindtest_id, tag_id)
            VALUES (?, ?);
            """,
            (1, 1),
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
            (1, None, 0, "missing"),
        )

    assert blindtest_repository.delete_blindtest(1) is True
    assert blindtest_repository.get_blindtest(1) is None
    assert blindtest_repository.delete_blindtest(1) is False

    with db_module.get_connection() as connection:
        assert (
            connection.execute(
                "SELECT COUNT(*) FROM blindtest_songs WHERE blindtest_id = ?;",
                (1,),
            ).fetchone()[0]
            == 0
        )
        assert (
            connection.execute(
                "SELECT COUNT(*) FROM blindtest_tag_links WHERE blindtest_id = ?;",
                (1,),
            ).fetchone()[0]
            == 0
        )


def test_save_blindtest_preserves_missing_slot_snapshot(monkeypatch, tmp_path) -> None:
    database_path = tmp_path / "blindup.db"
    monkeypatch.setattr(
        db_module,
        "settings",
        config_module.Settings(database_path=database_path),
    )

    db_module.init_db()

    saved = blindtest_repository.save_blindtest(
        blindtest_repository.BlindtestRecord(
            title="Broken slot",
            songs=[
                blindtest_repository.BlindtestSongRecord(
                    song_id=None,
                    order_index=0,
                    slot_status="missing",
                    source_title="Lost song",
                    source_artist="Lost artist",
                    source_album="Lost album",
                    source_year=2004,
                    source_genre="Electro",
                    source_background="/covers/lost.jpg",
                    custom_hint="important slide",
                )
            ],
        )
    )

    assert saved["songs"] == [
        {
            "id": 1,
            "blindtest_id": saved["id"],
            "song_id": None,
            "order_index": 0,
            "slot_status": "missing",
            "start_sec": None,
            "duration_sec": None,
            "source_title": "Lost song",
            "source_artist": "Lost artist",
            "source_album": "Lost album",
            "source_year": 2004,
            "source_genre": "Electro",
            "source_background": "/covers/lost.jpg",
            "override_title": None,
            "override_artist": None,
            "override_album": None,
            "override_year": None,
            "override_genre": None,
            "override_background": None,
            "custom_hint": "important slide",
        }
    ]


def test_validate_blindtest_links_marks_missing_song_rows(
    monkeypatch,
    tmp_path,
) -> None:
    database_path = tmp_path / "blindup.db"
    monkeypatch.setattr(
        db_module,
        "settings",
        config_module.Settings(database_path=database_path),
    )

    db_module.init_db()
    with db_module.get_connection() as connection:
        connection.execute(
            """
            INSERT INTO songs (id, file_hash, file_path, title)
            VALUES (?, ?, ?, ?);
            """,
            (1, "hash-1", str(tmp_path / "song.mp3"), "Remember me"),
        )
        connection.execute(
            "INSERT INTO blindtests (title) VALUES (?);",
            ("Validation",),
        )
        connection.execute(
            """
            INSERT INTO blindtest_songs (
                blindtest_id,
                song_id,
                order_index,
                slot_status,
                source_title
            )
            VALUES (?, ?, ?, ?, ?);
            """,
            (1, 1, 0, "ok", "Remember me"),
        )

    legacy_connection = sqlite3.connect(database_path)
    try:
        legacy_connection.execute("PRAGMA foreign_keys = OFF;")
        legacy_connection.execute("DELETE FROM songs WHERE id = ?;", (1,))
        legacy_connection.commit()
    finally:
        legacy_connection.close()

    summary = blindtest_repository.validate_blindtest_links(1)
    blindtest = blindtest_repository.get_blindtest(1)

    assert summary == {"validated_slots": 1, "missing_slots": 1}
    assert blindtest is not None
    assert blindtest["songs"][0]["song_id"] is None
    assert blindtest["songs"][0]["slot_status"] == "missing"
    assert blindtest["songs"][0]["source_title"] == "Remember me"


def test_validate_blindtest_links_marks_missing_files(monkeypatch, tmp_path) -> None:
    database_path = tmp_path / "blindup.db"
    monkeypatch.setattr(
        db_module,
        "settings",
        config_module.Settings(database_path=database_path),
    )

    db_module.init_db()
    with db_module.get_connection() as connection:
        connection.execute(
            """
            INSERT INTO songs (file_hash, file_path, title, artist)
            VALUES (?, ?, ?, ?);
            """,
            ("hash-1", str(tmp_path / "missing.mp3"), "Song 1", "Artist 1"),
        )
        connection.execute(
            "INSERT INTO blindtests (title) VALUES (?);",
            ("Validation",),
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

    summary = blindtest_repository.validate_blindtest_links(1)
    blindtest = blindtest_repository.get_blindtest(1)

    assert summary == {"validated_slots": 1, "missing_slots": 1}
    assert blindtest is not None
    assert blindtest["songs"][0]["song_id"] is None
    assert blindtest["songs"][0]["slot_status"] == "missing"
    assert blindtest["songs"][0]["source_title"] == "Song 1"
    assert blindtest["songs"][0]["source_artist"] == "Artist 1"


def test_mark_song_slots_missing_updates_references(monkeypatch, tmp_path) -> None:
    database_path = tmp_path / "blindup.db"
    monkeypatch.setattr(
        db_module,
        "settings",
        config_module.Settings(database_path=database_path),
    )

    db_module.init_db()
    with db_module.get_connection() as connection:
        connection.execute(
            """
            INSERT INTO songs (
                file_hash,
                file_path,
                title,
                artist,
                album,
                year,
                genre,
                cover_path
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?);
            """,
            (
                "hash-1",
                str(tmp_path / "song.mp3"),
                "Song 1",
                "Artist 1",
                "Album 1",
                2001,
                "Rock",
                "/covers/song.jpg",
            ),
        )
        connection.execute(
            "INSERT INTO blindtests (title) VALUES (?);",
            ("Validation",),
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

    updated = blindtest_repository.mark_song_slots_missing(
        {
            "id": 1,
            "title": "Song 1",
            "artist": "Artist 1",
            "album": "Album 1",
            "year": 2001,
            "genre": "Rock",
            "cover_path": "/covers/song.jpg",
        }
    )
    blindtest = blindtest_repository.get_blindtest(1)

    assert updated == 1
    assert blindtest is not None
    assert blindtest["songs"][0]["song_id"] is None
    assert blindtest["songs"][0]["slot_status"] == "missing"
    assert blindtest["songs"][0]["source_album"] == "Album 1"


def test_validate_blindtest_links_handles_existing_missing_and_valid_slots(
    monkeypatch,
    tmp_path,
) -> None:
    database_path = tmp_path / "blindup.db"
    monkeypatch.setattr(
        db_module,
        "settings",
        config_module.Settings(database_path=database_path),
    )

    existing_file = tmp_path / "song.mp3"
    existing_file.write_bytes(b"ok")

    db_module.init_db()
    with db_module.get_connection() as connection:
        connection.execute(
            """
            INSERT INTO songs (id, file_hash, file_path, title)
            VALUES (?, ?, ?, ?);
            """,
            (1, "hash-1", str(existing_file), "Song 1"),
        )
        connection.execute(
            "INSERT INTO blindtests (title) VALUES (?);",
            ("Validation",),
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
            INSERT INTO blindtest_songs (
                blindtest_id,
                song_id,
                order_index,
                slot_status,
                source_title
            )
            VALUES (?, ?, ?, ?, ?);
            """,
            (1, None, 1, "ok", "Broken"),
        )

    summary = blindtest_repository.validate_blindtest_links(1)
    blindtest = blindtest_repository.get_blindtest(1)

    assert summary == {"validated_slots": 2, "missing_slots": 0}
    assert blindtest is not None
    assert blindtest["songs"][0]["slot_status"] == "ok"
    assert blindtest["songs"][0]["song_id"] == 1
    assert blindtest["songs"][1]["slot_status"] == "missing"
    assert blindtest["songs"][1]["song_id"] is None


def test_normalize_blindtest_media_updates_raw_image_paths(
    monkeypatch,
    tmp_path,
) -> None:
    database_path = tmp_path / "blindup.db"
    storage_dir = tmp_path / "storage"
    monkeypatch.setattr(
        db_module,
        "settings",
        config_module.Settings(database_path=database_path, storage_dir=storage_dir),
    )
    monkeypatch.setattr(
        media_path_service,
        "settings",
        config_module.Settings(database_path=database_path, storage_dir=storage_dir),
    )

    background = tmp_path / "background.jpg"
    background.write_bytes(b"background")
    cover = tmp_path / "cover.jpg"
    cover.write_bytes(b"cover")

    db_module.init_db()
    with db_module.get_connection() as connection:
        connection.execute(
            """
            INSERT INTO blindtests (id, title, background_image)
            VALUES (?, ?, ?);
            """,
            (1, "Media", str(background)),
        )
        connection.execute(
            """
            INSERT INTO blindtest_songs (
                blindtest_id,
                song_id,
                order_index,
                slot_status,
                source_background,
                override_background
            )
            VALUES (?, ?, ?, ?, ?, ?);
            """,
            (1, None, 0, "missing", str(cover), str(cover)),
        )

    updated = blindtest_repository.normalize_blindtest_media(1)
    blindtest = blindtest_repository.get_blindtest(1)

    assert updated == 2
    assert blindtest is not None
    assert blindtest["background_image"].startswith("/media/backgrounds/")
    assert blindtest["songs"][0]["source_background"].startswith("/media/backgrounds/")
    assert blindtest["songs"][0]["override_background"].startswith(
        "/media/backgrounds/"
    )


def test_normalize_blindtest_media_leaves_public_paths_unchanged(
    monkeypatch,
    tmp_path,
) -> None:
    database_path = tmp_path / "blindup.db"
    storage_dir = tmp_path / "storage"
    monkeypatch.setattr(
        db_module,
        "settings",
        config_module.Settings(database_path=database_path, storage_dir=storage_dir),
    )
    monkeypatch.setattr(
        media_path_service,
        "settings",
        config_module.Settings(database_path=database_path, storage_dir=storage_dir),
    )

    db_module.init_db()
    with db_module.get_connection() as connection:
        connection.execute(
            """
            INSERT INTO blindtests (id, title, background_image)
            VALUES (?, ?, ?);
            """,
            (1, "Media", "/media/backgrounds/existing.jpg"),
        )
        connection.execute(
            """
            INSERT INTO blindtest_songs (
                blindtest_id,
                song_id,
                order_index,
                slot_status,
                source_background,
                override_background
            )
            VALUES (?, ?, ?, ?, ?, ?);
            """,
            (
                1,
                None,
                0,
                "missing",
                "/media/backgrounds/source.jpg",
                "/media/backgrounds/override.jpg",
            ),
        )

    updated = blindtest_repository.normalize_blindtest_media(1)

    assert updated == 0
