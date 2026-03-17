import pytest

import app.config as config_module
from app.services import audio_tag_service as service


class FakeTagFile(dict):
    def __init__(self):
        super().__init__()
        self.saved_with = None

    def save(self, target=None):
        self.saved_with = target


def test_save_audio_tags_writes_mp3_tags(monkeypatch, tmp_path) -> None:
    library_root = tmp_path / "library"
    library_root.mkdir()
    song_path = library_root / "track.mp3"
    song_path.write_bytes(b"mp3")
    fake_tags = FakeTagFile()

    monkeypatch.setattr(
        service,
        "settings",
        config_module.Settings(library_root_path=library_root),
    )
    monkeypatch.setattr(service, "EasyID3", lambda path: fake_tags)

    result = service.save_audio_tags(
        song_path,
        service.AudioTagUpdate(
            title=" Title ",
            artist="Artist",
            album="Album",
            year=2001,
            genre="Rock",
        ),
    )

    assert result == service.AudioTagUpdate(
        title="Title",
        artist="Artist",
        album="Album",
        year=2001,
        genre="Rock",
    )
    assert fake_tags == {
        "title": ["Title"],
        "artist": ["Artist"],
        "album": ["Album"],
        "date": ["2001"],
        "genre": ["Rock"],
    }
    assert fake_tags.saved_with == song_path.resolve()


def test_save_audio_tags_creates_mp3_header_when_missing(monkeypatch, tmp_path) -> None:
    library_root = tmp_path / "library"
    library_root.mkdir()
    song_path = library_root / "track.mp3"
    song_path.write_bytes(b"mp3")
    created_tags = FakeTagFile()
    call_count = {"value": 0}

    def fake_easyid3(path=None):
        call_count["value"] += 1
        if call_count["value"] == 1:
            raise service.ID3NoHeaderError("missing")
        assert path is None
        return created_tags

    monkeypatch.setattr(
        service,
        "settings",
        config_module.Settings(library_root_path=library_root),
    )
    monkeypatch.setattr(service, "EasyID3", fake_easyid3)

    result = service.save_audio_tags(
        song_path,
        service.AudioTagUpdate(
            title=None,
            artist="Artist",
            album=None,
            year=None,
            genre=None,
        ),
    )

    assert result == service.AudioTagUpdate(
        title=None,
        artist="Artist",
        album=None,
        year=None,
        genre=None,
    )
    assert created_tags == {"artist": ["Artist"]}
    assert created_tags.saved_with == song_path.resolve()


def test_save_audio_tags_writes_flac_tags(monkeypatch, tmp_path) -> None:
    library_root = tmp_path / "library"
    library_root.mkdir()
    song_path = library_root / "track.flac"
    song_path.write_bytes(b"flac")
    fake_tags = FakeTagFile()

    monkeypatch.setattr(
        service,
        "settings",
        config_module.Settings(library_root_path=library_root),
    )
    monkeypatch.setattr(service, "FLAC", lambda path: fake_tags)

    result = service.save_audio_tags(
        song_path,
        service.AudioTagUpdate(
            title="Song",
            artist="Artist",
            album="Album",
            year=2024,
            genre="Quiz",
        ),
    )

    assert result == service.AudioTagUpdate(
        title="Song",
        artist="Artist",
        album="Album",
        year=2024,
        genre="Quiz",
    )
    assert fake_tags == {
        "title": ["Song"],
        "artist": ["Artist"],
        "album": ["Album"],
        "date": ["2024"],
        "genre": ["Quiz"],
    }
    assert fake_tags.saved_with is None


def test_save_audio_tags_rejects_outside_library_root(monkeypatch, tmp_path) -> None:
    library_root = tmp_path / "library"
    library_root.mkdir()
    song_path = tmp_path / "outside.mp3"
    song_path.write_bytes(b"mp3")

    monkeypatch.setattr(
        service,
        "settings",
        config_module.Settings(library_root_path=library_root),
    )

    with pytest.raises(ValueError, match="inside the library root"):
        service.save_audio_tags(
            song_path,
            service.AudioTagUpdate(None, None, None, None, None),
        )


def test_save_audio_tags_rejects_missing_or_non_file_paths(
    monkeypatch, tmp_path
) -> None:
    library_root = tmp_path / "library"
    library_root.mkdir()
    missing_path = library_root / "missing.mp3"
    folder_path = library_root / "folder.mp3"
    folder_path.mkdir()

    monkeypatch.setattr(
        service,
        "settings",
        config_module.Settings(library_root_path=library_root),
    )

    with pytest.raises(FileNotFoundError, match="Audio file not found"):
        service.save_audio_tags(
            missing_path,
            service.AudioTagUpdate(None, None, None, None, None),
        )

    with pytest.raises(ValueError, match="Audio path is not a file"):
        service.save_audio_tags(
            folder_path,
            service.AudioTagUpdate(None, None, None, None, None),
        )


def test_save_audio_tags_rejects_unsupported_format(monkeypatch, tmp_path) -> None:
    library_root = tmp_path / "library"
    library_root.mkdir()
    song_path = library_root / "track.wav"
    song_path.write_bytes(b"wav")

    monkeypatch.setattr(
        service,
        "settings",
        config_module.Settings(library_root_path=library_root),
    )

    with pytest.raises(ValueError, match="Unsupported tag writing format"):
        service.save_audio_tags(
            song_path,
            service.AudioTagUpdate(None, None, None, None, None),
        )
