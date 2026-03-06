import app.config as config_module
import app.db as db_module
from app.repositories import blindtest_repository


def test_blindtest_timestamp_returns_iso_string() -> None:
    assert "T" in blindtest_repository._timestamp()


def test_get_first_blindtest_returns_none_when_empty(monkeypatch, tmp_path) -> None:
    database_path = tmp_path / "blindup.db"
    monkeypatch.setattr(
        db_module,
        "settings",
        config_module.Settings(database_path=database_path),
    )

    db_module.init_db()

    assert blindtest_repository.get_first_blindtest() is None


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
                    override_cover="/covers/override.jpg",
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
            "start_sec": 45.0,
            "duration_sec": 3.5,
            "override_title": "Opening",
            "override_artist": None,
            "override_album": None,
            "override_year": 1999,
            "override_genre": None,
            "override_cover": None,
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
            "start_sec": 10.0,
            "duration_sec": 1.5,
            "override_title": None,
            "override_artist": "Override artist",
            "override_album": "Override album",
            "override_year": None,
            "override_genre": "Pop",
            "override_cover": "/covers/override.jpg",
            "custom_hint": None,
        }
    ]
    assert blindtest_repository.get_blindtest(int(inserted["id"])) == updated
    assert blindtest_repository.get_first_blindtest() == updated
    assert blindtest_repository.get_blindtest(9999) is None
