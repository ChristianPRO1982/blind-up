import app.config as config_module
from app.services import song_file_service
from app.services.audio_metadata_service import compute_file_hash


def test_resolve_song_file_path_returns_existing_file_without_repair(
    monkeypatch,
    tmp_path,
) -> None:
    audio_path = tmp_path / "song.mp3"
    audio_path.write_bytes(b"ID3")
    monkeypatch.setattr(
        song_file_service.song_repository,
        "update_song_file_location",
        lambda *_args: (_ for _ in ()).throw(
            AssertionError("repair should not be triggered")
        ),
    )

    resolved_path = song_file_service.resolve_song_file_path(
        {
            "id": 1,
            "file_hash": "unused",
            "file_path": str(audio_path),
        }
    )

    assert resolved_path == audio_path


def test_resolve_song_file_path_repairs_legacy_path_by_hash(monkeypatch, tmp_path) -> None:
    library_root = tmp_path / "music-library"
    nested_dir = library_root / "album"
    nested_dir.mkdir(parents=True)
    audio_path = nested_dir / "track.mp3"
    audio_path.write_bytes(b"same-song")
    settings = config_module.Settings(
        database_path=tmp_path / "blindup.db",
        library_root_path=library_root,
    )
    monkeypatch.setattr(song_file_service, "settings", settings)
    repair_calls: list[tuple[int, str, int, int]] = []
    monkeypatch.setattr(
        song_file_service.song_repository,
        "update_song_file_location",
        lambda song_id, file_path, file_size, file_mtime_ns: repair_calls.append(
            (song_id, file_path, file_size, file_mtime_ns)
        ),
    )

    resolved_path = song_file_service.resolve_song_file_path(
        {
            "id": 7,
            "file_hash": compute_file_hash(audio_path),
            "file_path": "/legacy/music/track.mp3",
        }
    )

    assert resolved_path == audio_path.resolve()
    assert repair_calls == [
        (
            7,
            str(audio_path.resolve()),
            audio_path.stat().st_size,
            audio_path.stat().st_mtime_ns,
        )
    ]


def test_resolve_song_file_path_falls_back_to_full_library_scan(
    monkeypatch,
    tmp_path,
) -> None:
    library_root = tmp_path / "music-library"
    renamed_audio = library_root / "album" / "renamed-track.mp3"
    renamed_audio.parent.mkdir(parents=True)
    renamed_audio.write_bytes(b"same-song")
    settings = config_module.Settings(
        database_path=tmp_path / "blindup.db",
        library_root_path=library_root,
    )
    monkeypatch.setattr(song_file_service, "settings", settings)
    monkeypatch.setattr(
        song_file_service.song_repository,
        "update_song_file_location",
        lambda *_args: None,
    )

    resolved_path = song_file_service.resolve_song_file_path(
        {
            "id": 8,
            "file_hash": compute_file_hash(renamed_audio),
            "file_path": "/legacy/music/original-name.mp3",
        }
    )

    assert resolved_path == renamed_audio.resolve()


def test_resolve_song_file_path_returns_none_when_hash_cannot_be_matched(
    monkeypatch,
    tmp_path,
) -> None:
    library_root = tmp_path / "music-library"
    library_root.mkdir()
    settings = config_module.Settings(
        database_path=tmp_path / "blindup.db",
        library_root_path=library_root,
    )
    monkeypatch.setattr(song_file_service, "settings", settings)

    resolved_path = song_file_service.resolve_song_file_path(
        {
            "id": 3,
            "file_hash": "missing-hash",
            "file_path": "/legacy/music/missing.mp3",
        }
    )

    assert resolved_path is None


def test_find_matching_library_file_skips_unsupported_same_name_entries(
    monkeypatch,
    tmp_path,
) -> None:
    library_root = tmp_path / "music-library"
    library_root.mkdir()
    (library_root / "track.mp3").mkdir()
    settings = config_module.Settings(
        database_path=tmp_path / "blindup.db",
        library_root_path=library_root,
    )
    monkeypatch.setattr(song_file_service, "settings", settings)

    matched_path = song_file_service._find_matching_library_file(
        {
            "file_hash": "hash-1",
            "file_path": "/legacy/track.mp3",
        }
    )

    assert matched_path is None


def test_resolve_song_file_path_skips_duplicate_candidates_during_full_scan(
    monkeypatch,
    tmp_path,
) -> None:
    library_root = tmp_path / "music-library"
    library_root.mkdir()
    same_name_candidate = library_root / "track.mp3"
    same_name_candidate.write_bytes(b"wrong-song")
    matching_candidate = library_root / "zz-renamed-track.mp3"
    matching_candidate.write_bytes(b"right-song")
    settings = config_module.Settings(
        database_path=tmp_path / "blindup.db",
        library_root_path=library_root,
    )
    monkeypatch.setattr(song_file_service, "settings", settings)
    monkeypatch.setattr(
        song_file_service.song_repository,
        "update_song_file_location",
        lambda *_args: None,
    )

    resolved_path = song_file_service.resolve_song_file_path(
        {
            "id": 9,
            "file_hash": compute_file_hash(matching_candidate),
            "file_path": "/legacy/music/track.mp3",
        }
    )

    assert resolved_path == matching_candidate.resolve()


def test_iter_library_audio_files_is_sorted_and_filtered(tmp_path) -> None:
    root = tmp_path / "music-library"
    (root / "b").mkdir(parents=True)
    (root / "a").mkdir()
    (root / "b" / "track2.aac").write_bytes(b"2")
    (root / "a" / "track1.MP3").write_bytes(b"1")
    (root / "a" / "notes.txt").write_text("skip", encoding="utf-8")

    paths = list(song_file_service._iter_library_audio_files(root))

    assert paths == [
        (root / "a" / "track1.MP3").resolve(),
        (root / "b" / "track2.aac").resolve(),
    ]


def test_matches_hash_returns_false_when_hashing_fails(monkeypatch, tmp_path) -> None:
    audio_path = tmp_path / "song.mp3"
    audio_path.write_bytes(b"ID3")
    monkeypatch.setattr(
        song_file_service,
        "compute_file_hash",
        lambda *_args: (_ for _ in ()).throw(OSError("broken hash")),
    )

    assert song_file_service._matches_hash(audio_path, "expected-hash") is False
