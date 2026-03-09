import hashlib
import subprocess
from pathlib import Path

import pytest

from app.services import audio_metadata_service as service


def test_supported_audio_files_are_detected_case_insensitively(tmp_path) -> None:
    supported = tmp_path / "track.MP3"
    supported.write_bytes(b"audio")
    unsupported = tmp_path / "notes.txt"
    unsupported.write_text("notes", encoding="utf-8")
    folder = tmp_path / "album"
    folder.mkdir()

    assert service.is_supported_audio_file(supported) is True
    assert service.is_supported_audio_file(unsupported) is False
    assert service.is_supported_audio_file(folder) is False


def test_compute_file_hash_is_sha256_of_file_content(tmp_path) -> None:
    song_path = tmp_path / "song.mp3"
    song_path.write_bytes(b"blind-up")

    assert (
        service.compute_file_hash(song_path) == hashlib.sha256(b"blind-up").hexdigest()
    )


def test_extract_audio_metadata_returns_normalized_tags(monkeypatch, tmp_path) -> None:
    cover_path = tmp_path / "covers" / "hash.jpg"
    monkeypatch.setattr(
        service,
        "_probe_audio_file",
        lambda _: {
            "format": {
                "duration": "12.5",
                "tags": {
                    "TITLE": "Song Title",
                    "ARTIST": "Artist Name",
                    "ALBUM": "Album Name",
                    "DATE": "1999-04-01",
                    "GENRE": "Rock",
                },
            }
        },
    )
    monkeypatch.setattr(
        service,
        "_extract_cover",
        lambda *_: cover_path,
    )

    metadata = service.extract_audio_metadata(
        tmp_path / "song.mp3",
        "hash",
        tmp_path / "covers",
    )

    assert metadata == service.AudioMetadata(
        duration_sec=12.5,
        title="Song Title",
        artist="Artist Name",
        album="Album Name",
        year=1999,
        genre="Rock",
        cover_path=str(cover_path),
    )


def test_run_command_uses_subprocess_run(monkeypatch) -> None:
    completed = subprocess.CompletedProcess(["cmd"], 0, stdout="{}", stderr="")
    captured: dict[str, object] = {}

    def fake_run(*args, **kwargs):
        captured["args"] = list(args)
        captured.update(kwargs)
        return completed

    monkeypatch.setattr(service.subprocess, "run", fake_run)

    result = service._run_command(["cmd"])

    assert result is completed
    assert captured == {
        "args": [["cmd"]],
        "check": True,
        "capture_output": True,
        "text": True,
    }


def test_probe_audio_file_requires_ffprobe(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(service.shutil, "which", lambda _: None)

    with pytest.raises(RuntimeError, match="ffprobe is required"):
        service._probe_audio_file(tmp_path / "song.mp3")


def test_probe_audio_file_parses_json(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(service.shutil, "which", lambda _: "/usr/bin/ffprobe")
    monkeypatch.setattr(
        service,
        "_run_command",
        lambda command: subprocess.CompletedProcess(
            command,
            0,
            stdout='{"format": {"duration": "3.5"}}',
            stderr="",
        ),
    )

    probe_data = service._probe_audio_file(tmp_path / "song.mp3")

    assert probe_data == {"format": {"duration": "3.5"}}


def test_normalized_tags_and_parsers_handle_missing_values() -> None:
    assert service._normalized_tags(None) == {}
    assert service._normalized_tags({"TITLE": "Song"}) == {"title": "Song"}
    assert service._parse_duration(None) is None
    assert service._parse_duration("") is None
    assert service._parse_duration(4) == 4.0
    assert service._parse_year(None) is None
    assert service._parse_year("Released in 2007") == 2007
    assert service._parse_year("unknown") is None


def test_has_cover_stream_checks_attached_picture_flag() -> None:
    assert service._has_cover_stream({"streams": []}) is False
    assert (
        service._has_cover_stream(
            {
                "streams": [
                    {"codec_type": "audio"},
                    {"codec_type": "video", "disposition": {"attached_pic": 1}},
                ]
            }
        )
        is True
    )


def test_extract_cover_returns_none_without_cover_stream(tmp_path) -> None:
    assert (
        service._extract_cover(
            tmp_path / "song.mp3",
            "hash",
            tmp_path / "covers",
            {"streams": []},
        )
        is None
    )


def test_extract_cover_returns_none_without_ffmpeg(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(service.shutil, "which", lambda _: None)

    assert (
        service._extract_cover(
            tmp_path / "song.mp3",
            "hash",
            tmp_path / "covers",
            {"streams": [{"codec_type": "video", "disposition": {"attached_pic": 1}}]},
        )
        is None
    )


def test_extract_cover_returns_none_when_ffmpeg_fails(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(service.shutil, "which", lambda _: "/usr/bin/ffmpeg")

    def raise_error(command):
        raise subprocess.CalledProcessError(1, command)

    monkeypatch.setattr(service, "_run_command", raise_error)

    assert (
        service._extract_cover(
            tmp_path / "song.mp3",
            "hash",
            tmp_path / "covers",
            {"streams": [{"codec_type": "video", "disposition": {"attached_pic": 1}}]},
        )
        is None
    )


def test_extract_cover_returns_path_when_ffmpeg_succeeds(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(service.shutil, "which", lambda _: "/usr/bin/ffmpeg")

    def fake_run(command):
        output_path = Path(command[-1])
        output_path.write_bytes(b"cover")
        return subprocess.CompletedProcess(command, 0, stdout="", stderr="")

    monkeypatch.setattr(service, "_run_command", fake_run)

    cover_path = service._extract_cover(
        tmp_path / "song.mp3",
        "hash",
        tmp_path / "covers",
        {"streams": [{"codec_type": "video", "disposition": {"attached_pic": 1}}]},
    )

    assert cover_path == tmp_path / "covers" / "hash.jpg"
    assert cover_path.read_bytes() == b"cover"
