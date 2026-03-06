from __future__ import annotations

import logging
import os
from dataclasses import asdict, dataclass
from pathlib import Path

from app.config import settings
from app.repositories.song_repository import (
    SongRecord,
    delete_songs_missing_from,
    upsert_song,
)
from app.services.audio_metadata_service import (
    compute_file_hash,
    extract_audio_metadata,
    is_supported_audio_file,
)

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ScanSummary:
    root_path: str
    scanned_files: int
    added: int
    updated: int
    removed: int
    skipped: int
    errors: int

    def as_dict(self) -> dict[str, int | str]:
        return asdict(self)


def scan_library(root_path: str) -> ScanSummary:
    root = Path(root_path).expanduser().resolve()
    if not root.exists() or not root.is_dir():
        raise FileNotFoundError(root_path)

    logger.info("scan started")
    logger.info("root path used: %s", root)

    seen_hashes: set[str] = set()
    scanned_files = 0
    added = 0
    updated = 0
    skipped = 0
    errors = 0

    for audio_path in _iter_audio_files(root):
        scanned_files += 1
        logger.info("file processed: %s", audio_path)
        try:
            file_hash = compute_file_hash(audio_path)
            metadata = extract_audio_metadata(
                audio_path,
                file_hash,
                settings.covers_dir,
            )
            result = upsert_song(
                SongRecord(
                    file_hash=file_hash,
                    file_path=str(audio_path),
                    duration_sec=metadata.duration_sec,
                    title=metadata.title,
                    artist=metadata.artist,
                    album=metadata.album,
                    year=metadata.year,
                    genre=metadata.genre,
                    cover_path=metadata.cover_path,
                )
            )
            seen_hashes.add(file_hash)
        except Exception as exc:
            skipped += 1
            errors += 1
            logger.error("metadata extraction failed for %s: %s", audio_path, exc)
            logger.info("file skipped: %s", audio_path)
            continue

        if result == "added":
            added += 1
            logger.info("song inserted: %s", audio_path)
        else:
            updated += 1
            logger.info("song updated: %s", audio_path)

    removed = delete_songs_missing_from(seen_hashes)
    if removed:
        logger.info("song removed: %s", removed)

    logger.info("scan finished")
    return ScanSummary(
        root_path=str(root),
        scanned_files=scanned_files,
        added=added,
        updated=updated,
        removed=removed,
        skipped=skipped,
        errors=errors,
    )


def _iter_audio_files(root: Path):
    paths: list[Path] = []
    for current_root, dirnames, filenames in os.walk(root):
        dirnames.sort()
        for filename in filenames:
            path = Path(current_root) / filename
            if is_supported_audio_file(path):
                paths.append(path.resolve())

    for path in sorted(paths):
        yield path
