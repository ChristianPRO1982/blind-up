from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from mutagen.easyid3 import EasyID3
from mutagen.flac import FLAC
from mutagen.id3 import ID3NoHeaderError

from app.config import settings


@dataclass(frozen=True)
class AudioTagUpdate:
    title: str | None
    artist: str | None
    album: str | None
    year: int | None
    genre: str | None


def save_audio_tags(file_path: Path, update: AudioTagUpdate) -> AudioTagUpdate:
    resolved_path = file_path.expanduser().resolve()
    library_root = settings.library_root_path.expanduser().resolve()

    if not resolved_path.is_relative_to(library_root):
        raise ValueError("Audio file must stay inside the library root")
    if not resolved_path.exists():
        raise FileNotFoundError(f"Audio file not found: {resolved_path}")
    if not resolved_path.is_file():
        raise ValueError(f"Audio path is not a file: {resolved_path}")

    normalized_update = AudioTagUpdate(
        title=_normalize_text(update.title),
        artist=_normalize_text(update.artist),
        album=_normalize_text(update.album),
        year=update.year,
        genre=_normalize_text(update.genre),
    )

    extension = resolved_path.suffix.lower()
    if extension == ".mp3":
        _save_mp3_tags(resolved_path, normalized_update)
    elif extension == ".flac":
        _save_flac_tags(resolved_path, normalized_update)
    else:
        raise ValueError(f"Unsupported tag writing format: {extension or 'unknown'}")

    return normalized_update


def _normalize_text(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    return normalized if normalized != "" else None


def _save_mp3_tags(file_path: Path, update: AudioTagUpdate) -> None:
    try:
        tags = EasyID3(file_path)
    except ID3NoHeaderError:
        tags = EasyID3()
    _apply_common_tags(tags, update)
    tags.save(file_path)


def _save_flac_tags(file_path: Path, update: AudioTagUpdate) -> None:
    tags = FLAC(file_path)
    _apply_common_tags(tags, update)
    tags.save()


def _apply_common_tags(tags: object, update: AudioTagUpdate) -> None:
    _set_or_delete(tags, "title", update.title)
    _set_or_delete(tags, "artist", update.artist)
    _set_or_delete(tags, "album", update.album)
    _set_or_delete(tags, "date", str(update.year) if update.year is not None else None)
    _set_or_delete(tags, "genre", update.genre)


def _set_or_delete(tags: object, key: str, value: str | None) -> None:
    if value is None:
        tags.pop(key, None)
        return
    tags[key] = [value]
