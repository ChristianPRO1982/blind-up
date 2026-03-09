from __future__ import annotations

import hashlib
import json
import logging
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger(__name__)

SUPPORTED_AUDIO_EXTENSIONS = {".mp3", ".flac", ".m4a", ".aac", ".mp4"}


@dataclass(frozen=True)
class AudioMetadata:
    duration_sec: float | None
    title: str | None
    artist: str | None
    album: str | None
    year: int | None
    genre: str | None
    cover_path: str | None


def is_supported_audio_file(path: Path) -> bool:
    return path.is_file() and path.suffix.lower() in SUPPORTED_AUDIO_EXTENSIONS


def compute_file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file_handle:
        for chunk in iter(lambda: file_handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def extract_audio_metadata(
    path: Path,
    file_hash: str,
    covers_dir: Path,
) -> AudioMetadata:
    probe_data = _probe_audio_file(path)
    format_data = probe_data.get("format", {})
    tags = _normalized_tags(format_data.get("tags"))
    duration_sec = _parse_duration(format_data.get("duration"))
    cover_path = _extract_cover(path, file_hash, covers_dir, probe_data)

    return AudioMetadata(
        duration_sec=duration_sec,
        title=tags.get("title"),
        artist=tags.get("artist"),
        album=tags.get("album"),
        year=_parse_year(tags.get("year") or tags.get("date")),
        genre=tags.get("genre"),
        cover_path=str(cover_path) if cover_path is not None else None,
    )


def _run_command(command: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        check=True,
        capture_output=True,
        text=True,
    )


def _probe_audio_file(path: Path) -> dict:
    ffprobe_path = shutil.which("ffprobe")
    if ffprobe_path is None:
        raise RuntimeError("ffprobe is required for library scanning")

    result = _run_command(
        [
            ffprobe_path,
            "-v",
            "error",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            str(path),
        ]
    )
    return json.loads(result.stdout)


def _normalized_tags(raw_tags: dict | None) -> dict[str, str]:
    if not isinstance(raw_tags, dict):
        return {}
    return {str(key).lower(): str(value) for key, value in raw_tags.items()}


def _parse_duration(raw_duration: str | float | int | None) -> float | None:
    if raw_duration in (None, ""):
        return None
    return float(raw_duration)


def _parse_year(raw_year: str | None) -> int | None:
    if not raw_year:
        return None
    for index in range(len(raw_year) - 3):
        chunk = raw_year[index : index + 4]
        if chunk.isdigit():
            return int(chunk)
    return None


def _has_cover_stream(probe_data: dict) -> bool:
    for stream in probe_data.get("streams", []):
        if stream.get("codec_type") != "video":
            continue
        if stream.get("disposition", {}).get("attached_pic") == 1:
            return True
    return False


def _extract_cover(
    path: Path,
    file_hash: str,
    covers_dir: Path,
    probe_data: dict,
) -> Path | None:
    if not _has_cover_stream(probe_data):
        return None

    ffmpeg_path = shutil.which("ffmpeg")
    if ffmpeg_path is None:
        logger.warning("ffmpeg unavailable, cover extraction skipped for %s", path)
        return None

    covers_dir.mkdir(parents=True, exist_ok=True)
    cover_path = covers_dir / f"{file_hash}.jpg"
    try:
        _run_command(
            [
                ffmpeg_path,
                "-v",
                "error",
                "-y",
                "-i",
                str(path),
                "-map",
                "0:v:0",
                "-frames:v",
                "1",
                str(cover_path),
            ]
        )
    except subprocess.CalledProcessError:
        logger.warning("cover extraction failed for %s", path)
        return None
    return cover_path
