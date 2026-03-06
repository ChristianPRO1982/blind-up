from pathlib import Path

import pytest

import app.config as config_module
import app.db as db_module
from app.repositories import blindtest_repository
from app.services import audio_metadata_service
from app.services import library_scan_service as scan_service


def _configure_scan_settings(monkeypatch, tmp_path) -> config_module.Settings:
    settings = config_module.Settings(
        database_path=tmp_path / "blindup.db",
        storage_dir=tmp_path / "storage",
        covers_dir=tmp_path / "storage" / "covers",
    )
    monkeypatch.setattr(db_module, "settings", settings)
    monkeypatch.setattr(scan_service, "settings", settings)
    db_module.init_db()
    return settings


def test_iter_audio_files_is_recursive_sorted_and_filtered(tmp_path) -> None:
    root = tmp_path / "music"
    (root / "b").mkdir(parents=True)
    (root / "a").mkdir()
    (root / "b" / "track2.aac").write_bytes(b"2")
    (root / "a" / "track1.MP3").write_bytes(b"1")
    (root / "a" / "notes.txt").write_text("skip", encoding="utf-8")
    (root / "root.flac").write_bytes(b"3")

    paths = list(scan_service._iter_audio_files(root))

    assert paths == [
        (root / "a" / "track1.MP3").resolve(),
        (root / "b" / "track2.aac").resolve(),
        (root / "root.flac").resolve(),
    ]


def test_scan_library_syncs_database_and_removes_missing_files(
    monkeypatch,
    tmp_path,
) -> None:
    _configure_scan_settings(monkeypatch, tmp_path)
    root = tmp_path / "music"
    (root / "disc2").mkdir(parents=True)
    (root / "disc1").mkdir()
    first_song = root / "disc2" / "b-song.MP3"
    second_song = root / "disc1" / "a-song.aac"
    ignored_file = root / "disc1" / "cover.jpg"
    first_song.write_bytes(b"first")
    second_song.write_bytes(b"second")
    ignored_file.write_bytes(b"ignored")

    def fake_extract_metadata(path: Path, file_hash: str, covers_dir: Path):
        return audio_metadata_service.AudioMetadata(
            duration_sec=float(len(path.name)),
            title=path.stem,
            artist="BlindUp",
            album="Scan",
            year=2026,
            genre="Quiz",
            cover_path=str(covers_dir / f"{file_hash}.jpg"),
        )

    monkeypatch.setattr(scan_service, "extract_audio_metadata", fake_extract_metadata)

    first_summary = scan_service.scan_library(str(root))

    with db_module.get_connection() as connection:
        rows = connection.execute(
            "SELECT file_hash, file_path, title FROM songs ORDER BY file_path;"
        ).fetchall()

    renamed_song = root / "disc1" / "a-song-renamed.aac"
    second_song.rename(renamed_song)
    first_song.unlink()

    second_summary = scan_service.scan_library(str(root))

    with db_module.get_connection() as connection:
        final_rows = connection.execute(
            "SELECT file_path, title FROM songs ORDER BY file_path;"
        ).fetchall()

    assert first_summary.as_dict() == {
        "root_path": str(root.resolve()),
        "scanned_files": 2,
        "added": 2,
        "updated": 0,
        "removed": 0,
        "broken_slots": 0,
        "skipped": 0,
        "errors": 0,
    }
    assert [row["file_path"] for row in rows] == [
        str((root / "disc1" / "a-song.aac").resolve()),
        str((root / "disc2" / "b-song.MP3").resolve()),
    ]
    assert [row["title"] for row in rows] == ["a-song", "b-song"]
    assert second_summary.as_dict() == {
        "root_path": str(root.resolve()),
        "scanned_files": 1,
        "added": 0,
        "updated": 1,
        "removed": 1,
        "broken_slots": 0,
        "skipped": 0,
        "errors": 0,
    }
    assert [dict(row) for row in final_rows] == [
        {
            "file_path": str(renamed_song.resolve()),
            "title": "a-song-renamed",
        }
    ]


def test_scan_library_skips_broken_files_and_continues(monkeypatch, tmp_path) -> None:
    _configure_scan_settings(monkeypatch, tmp_path)
    root = tmp_path / "music"
    root.mkdir()
    good_song = root / "good.mp4"
    bad_song = root / "bad.m4a"
    good_song.write_bytes(b"good")
    bad_song.write_bytes(b"bad")

    def fake_extract_metadata(path: Path, file_hash: str, covers_dir: Path):
        if path == bad_song.resolve():
            raise ValueError("broken metadata")
        return audio_metadata_service.AudioMetadata(
            duration_sec=1.0,
            title=path.stem,
            artist=None,
            album=None,
            year=None,
            genre=None,
            cover_path=None,
        )

    monkeypatch.setattr(scan_service, "extract_audio_metadata", fake_extract_metadata)

    summary = scan_service.scan_library(str(root))

    with db_module.get_connection() as connection:
        rows = connection.execute("SELECT title FROM songs ORDER BY title;").fetchall()

    assert summary.as_dict() == {
        "root_path": str(root.resolve()),
        "scanned_files": 2,
        "added": 1,
        "updated": 0,
        "removed": 0,
        "broken_slots": 0,
        "skipped": 1,
        "errors": 1,
    }
    assert [dict(row) for row in rows] == [{"title": "good"}]


def test_scan_library_breaks_referenced_slots_before_deleting_song(
    monkeypatch,
    tmp_path,
) -> None:
    _configure_scan_settings(monkeypatch, tmp_path)
    root = tmp_path / "music"
    root.mkdir()
    song_path = root / "keep.mp3"
    song_path.write_bytes(b"keep")

    def fake_extract_metadata(path: Path, file_hash: str, covers_dir: Path):
        return audio_metadata_service.AudioMetadata(
            duration_sec=2.0,
            title=path.stem,
            artist="BlindUp",
            album=None,
            year=None,
            genre=None,
            cover_path=None,
        )

    monkeypatch.setattr(scan_service, "extract_audio_metadata", fake_extract_metadata)

    first_summary = scan_service.scan_library(str(root))
    blindtest_repository.save_blindtest(
        blindtest_repository.BlindtestRecord(
            title="Broken slots",
            songs=[
                blindtest_repository.BlindtestSongRecord(
                    song_id=1,
                    order_index=0,
                )
            ],
        )
    )

    song_path.unlink()
    second_summary = scan_service.scan_library(str(root))

    with db_module.get_connection() as connection:
        songs = connection.execute("SELECT * FROM songs;").fetchall()
        slots = connection.execute(
            """
            SELECT song_id, slot_status, source_title, source_artist
            FROM blindtest_songs
            ORDER BY id;
            """
        ).fetchall()

    assert first_summary.as_dict()["broken_slots"] == 0
    assert second_summary.as_dict() == {
        "root_path": str(root.resolve()),
        "scanned_files": 0,
        "added": 0,
        "updated": 0,
        "removed": 1,
        "broken_slots": 1,
        "skipped": 0,
        "errors": 0,
    }
    assert songs == []
    assert [dict(row) for row in slots] == [
        {
            "song_id": None,
            "slot_status": "missing",
            "source_title": "keep",
            "source_artist": "BlindUp",
        }
    ]


def test_scan_library_rejects_missing_root() -> None:
    with pytest.raises(FileNotFoundError):
        scan_service.scan_library("/missing/blindup")
