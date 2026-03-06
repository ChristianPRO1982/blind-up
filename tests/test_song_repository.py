import app.config as config_module
import app.db as db_module
from app.repositories import song_repository


def test_upsert_song_inserts_then_updates(monkeypatch, tmp_path) -> None:
    database_path = tmp_path / "blindup.db"
    settings = config_module.Settings(database_path=database_path)
    monkeypatch.setattr(db_module, "settings", settings)
    timestamps = iter(["2026-03-06T10:00:00+00:00", "2026-03-06T10:05:00+00:00"])
    monkeypatch.setattr(song_repository, "_timestamp", lambda: next(timestamps))

    db_module.init_db()

    added_result = song_repository.upsert_song(
        song_repository.SongRecord(
            file_hash="hash-1",
            file_path="/music/song-1.mp3",
            duration_sec=10.0,
            title="Song 1",
            artist="Artist 1",
            album="Album 1",
            year=2001,
            genre="Rock",
            cover_path="/covers/hash-1.jpg",
        )
    )
    inserted = song_repository.get_song_by_hash("hash-1")

    updated_result = song_repository.upsert_song(
        song_repository.SongRecord(
            file_hash="hash-1",
            file_path="/music/song-1-renamed.mp3",
            duration_sec=12.0,
            title="Song 1 Updated",
            artist="Artist 1",
            album="Album 1",
            year=2002,
            genre="Pop",
            cover_path=None,
        )
    )
    updated = song_repository.get_song_by_hash("hash-1")

    assert added_result == "added"
    assert inserted is not None
    assert inserted["created_at"] == "2026-03-06T10:00:00+00:00"
    assert inserted["updated_at"] == "2026-03-06T10:00:00+00:00"
    assert updated_result == "updated"
    assert updated is not None
    assert updated["file_path"] == "/music/song-1-renamed.mp3"
    assert updated["duration_sec"] == 12.0
    assert updated["title"] == "Song 1 Updated"
    assert updated["year"] == 2002
    assert updated["genre"] == "Pop"
    assert updated["cover_path"] is None
    assert updated["created_at"] == "2026-03-06T10:00:00+00:00"
    assert updated["updated_at"] == "2026-03-06T10:05:00+00:00"
    assert song_repository.get_song_by_id(int(updated["id"])) == updated


def test_list_songs_returns_rows_in_display_order(monkeypatch, tmp_path) -> None:
    database_path = tmp_path / "blindup.db"
    monkeypatch.setattr(
        db_module,
        "settings",
        config_module.Settings(database_path=database_path),
    )

    db_module.init_db()
    song_repository.upsert_song(
        song_repository.SongRecord(
            file_hash="hash-b",
            file_path="/music/b.mp3",
            duration_sec=12.0,
            title="Bravo",
            artist="Artist B",
            album=None,
            year=None,
            genre=None,
            cover_path=None,
        )
    )
    song_repository.upsert_song(
        song_repository.SongRecord(
            file_hash="hash-a",
            file_path="/music/a.mp3",
            duration_sec=10.0,
            title="Alpha",
            artist="Artist A",
            album=None,
            year=None,
            genre=None,
            cover_path=None,
        )
    )

    songs = song_repository.list_songs()

    assert [song["title"] for song in songs] == ["Alpha", "Bravo"]
    assert song_repository.get_song_by_id(9999) is None


def test_delete_songs_missing_from_removes_absent_rows(monkeypatch, tmp_path) -> None:
    database_path = tmp_path / "blindup.db"
    monkeypatch.setattr(
        db_module,
        "settings",
        config_module.Settings(database_path=database_path),
    )

    db_module.init_db()
    song_repository.upsert_song(
        song_repository.SongRecord(
            file_hash="keep",
            file_path="/music/keep.mp3",
            duration_sec=None,
            title=None,
            artist=None,
            album=None,
            year=None,
            genre=None,
            cover_path=None,
        )
    )
    song_repository.upsert_song(
        song_repository.SongRecord(
            file_hash="remove",
            file_path="/music/remove.mp3",
            duration_sec=None,
            title=None,
            artist=None,
            album=None,
            year=None,
            genre=None,
            cover_path=None,
        )
    )

    removed_count = song_repository.delete_songs_missing_from({"keep"})

    assert removed_count == 1
    assert song_repository.get_song_by_hash("keep") is not None
    assert song_repository.get_song_by_hash("remove") is None

    removed_remaining = song_repository.delete_songs_missing_from(set())

    assert removed_remaining == 1
    assert song_repository.get_song_by_hash("keep") is None
