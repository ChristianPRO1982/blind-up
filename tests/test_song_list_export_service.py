import app.config as config_module
import app.db as db_module
from app.repositories import song_repository
from app.services.song_list_export_service import export_song_list_tsv


def test_export_song_list_tsv_writes_headers_and_song_rows(
    monkeypatch,
    tmp_path,
) -> None:
    database_path = tmp_path / "blindup.db"
    library_root_path = tmp_path / "music-library"
    library_root_path.mkdir()
    monkeypatch.setattr(
        db_module,
        "settings",
        config_module.Settings(database_path=database_path),
    )

    db_module.init_db()
    song_repository.upsert_song(
        song_repository.SongRecord(
            file_hash="hash-1",
            file_path="/music/song-1.mp3",
            file_size=None,
            file_mtime_ns=None,
            duration_sec=10.0,
            title="Song 1",
            artist="Artist 1",
            album="Album 1",
            year=2001,
            genre="Rock",
            cover_path=None,
        )
    )
    song_repository.upsert_song(
        song_repository.SongRecord(
            file_hash="hash-2",
            file_path="/music/song-2.mp3",
            file_size=None,
            file_mtime_ns=None,
            duration_sec=12.0,
            title="Song 2",
            artist=None,
            album="Album 2",
            year=None,
            genre="Pop",
            cover_path=None,
        )
    )

    export_path = export_song_list_tsv(library_root_path)

    assert export_path == library_root_path / "song_list.tsv"
    assert export_path.read_text(encoding="utf-8") == (
        "file_path\ttitle\tartist\talbum\tyear\tgenre\n"
        "/music/song-1.mp3\tSong 1\tArtist 1\tAlbum 1\t2001\tRock\n"
        "/music/song-2.mp3\tSong 2\t\tAlbum 2\t\tPop\n"
    )


def test_export_song_list_tsv_rejects_missing_root(tmp_path) -> None:
    missing_root = tmp_path / "missing-library"

    try:
        export_song_list_tsv(missing_root)
    except FileNotFoundError as exc:
        assert str(missing_root) in str(exc)
    else:
        raise AssertionError("expected FileNotFoundError")


def test_export_song_list_tsv_rejects_file_root(tmp_path) -> None:
    file_root = tmp_path / "music-library"
    file_root.write_text("not a directory", encoding="utf-8")

    try:
        export_song_list_tsv(file_root)
    except NotADirectoryError as exc:
        assert str(file_root) in str(exc)
    else:
        raise AssertionError("expected NotADirectoryError")
