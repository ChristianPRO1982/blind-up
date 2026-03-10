from __future__ import annotations

import logging
import os
from dataclasses import asdict, dataclass
from pathlib import Path
from threading import Event
from typing import Literal

from app.config import settings
from app.repositories import blindtest_repository
from app.repositories.song_repository import (
    SongRecord,
    delete_songs_by_ids,
    get_song_by_hash,
    get_song_scan_index,
    list_songs_missing_from,
    upsert_song,
)
from app.services.audio_metadata_service import (
    compute_file_hash,
    extract_audio_metadata,
    is_supported_audio_file,
)
from app.services.media_path_service import build_media_url

logger = logging.getLogger(__name__)
ScanMode = Literal["light", "update"]


class ScanCancelled(Exception):
    """Raised when a running library scan is cancelled by the host."""


@dataclass(frozen=True)
class ScanSummary:
    scan_mode: ScanMode
    root_path: str
    scanned_files: int
    added: int
    updated: int
    removed: int
    broken_slots: int
    impacted_blindtests: list[dict[str, object]]
    skipped: int
    errors: int

    def as_dict(self) -> dict[str, object]:
        return asdict(self)


def _raise_if_cancelled(cancel_event: Event | None) -> None:
    if cancel_event is not None and cancel_event.is_set():
        raise ScanCancelled("Scan stopped")


def scan_library(
    root_path: str,
    cancel_event: Event | None = None,
    mode: ScanMode = "light",
) -> ScanSummary:
    root = Path(root_path).expanduser().resolve()
    if not root.exists() or not root.is_dir():
        raise FileNotFoundError(root_path)

    logger.info("scan started")
    logger.info("scan mode used: %s", mode)
    logger.info("root path used: %s", root)

    if mode == "light":
        return _scan_library_light(root, cancel_event)
    return _scan_library_update(root, cancel_event)


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


def _scan_library_light(root: Path, cancel_event: Event | None) -> ScanSummary:
    audio_paths = list(_iter_audio_files(root))
    existing_by_path = get_song_scan_index()
    current_paths = {str(path) for path in audio_paths}
    missing_songs = [
        song
        for song in existing_by_path.values()
        if str(song["file_path"]) not in current_paths
    ]
    removed, broken_slots, impacted_blindtests = _remove_missing_songs(
        missing_songs,
        cancel_event,
    )

    added = 0
    skipped = 0
    errors = 0
    for audio_path in audio_paths:
        _raise_if_cancelled(cancel_event)
        logger.info("file processed: %s", audio_path)
        if str(audio_path) in existing_by_path:
            logger.info("song already known, skipped update path: %s", audio_path)
            continue

        try:
            stat_result = audio_path.stat()
            file_hash = compute_file_hash(audio_path)
            if get_song_by_hash(file_hash) is not None:
                logger.info("song hash already known, skipped insert: %s", audio_path)
                continue

            metadata = extract_audio_metadata(
                audio_path,
                file_hash,
                settings.covers_dir,
            )
            upsert_song(
                SongRecord(
                    file_hash=file_hash,
                    file_path=str(audio_path),
                    file_size=stat_result.st_size,
                    file_mtime_ns=stat_result.st_mtime_ns,
                    duration_sec=metadata.duration_sec,
                    title=metadata.title,
                    artist=metadata.artist,
                    album=metadata.album,
                    year=metadata.year,
                    genre=metadata.genre,
                    cover_path=(
                        build_media_url("covers", Path(metadata.cover_path).name)
                        if metadata.cover_path
                        else None
                    ),
                )
            )
            added += 1
            logger.info("song inserted: %s", audio_path)
        except Exception as exc:
            skipped += 1
            errors += 1
            logger.error("metadata extraction failed for %s: %s", audio_path, exc)
            logger.info("file skipped: %s", audio_path)

    logger.info("scan finished")
    return ScanSummary(
        scan_mode="light",
        root_path=str(root),
        scanned_files=len(audio_paths),
        added=added,
        updated=0,
        removed=removed,
        broken_slots=broken_slots,
        impacted_blindtests=impacted_blindtests,
        skipped=skipped,
        errors=errors,
    )


def _scan_library_update(root: Path, cancel_event: Event | None) -> ScanSummary:
    seen_hashes: set[str] = set()
    scanned_files = 0
    added = 0
    updated = 0
    broken_slots = 0
    skipped = 0
    errors = 0
    existing_by_path = get_song_scan_index()

    for audio_path in _iter_audio_files(root):
        _raise_if_cancelled(cancel_event)
        scanned_files += 1
        logger.info("file processed: %s", audio_path)
        try:
            stat_result = audio_path.stat()
            existing = existing_by_path.get(str(audio_path))
            if _can_skip_known_file(existing, stat_result):
                seen_hashes.add(str(existing["file_hash"]))
                logger.info("song unchanged, skipped hash/metadata: %s", audio_path)
                continue

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
                    file_size=stat_result.st_size,
                    file_mtime_ns=stat_result.st_mtime_ns,
                    duration_sec=metadata.duration_sec,
                    title=metadata.title,
                    artist=metadata.artist,
                    album=metadata.album,
                    year=metadata.year,
                    genre=metadata.genre,
                    cover_path=(
                        build_media_url("covers", Path(metadata.cover_path).name)
                        if metadata.cover_path
                        else None
                    ),
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

    _raise_if_cancelled(cancel_event)
    missing_songs = list_songs_missing_from(seen_hashes)
    removed, broken_slots, impacted_blindtests = _remove_missing_songs(
        missing_songs,
        cancel_event,
    )

    logger.info("scan finished")
    return ScanSummary(
        scan_mode="update",
        root_path=str(root),
        scanned_files=scanned_files,
        added=added,
        updated=updated,
        removed=removed,
        broken_slots=broken_slots,
        impacted_blindtests=impacted_blindtests,
        skipped=skipped,
        errors=errors,
    )


def _remove_missing_songs(
    missing_songs: list[dict[str, object]],
    cancel_event: Event | None,
) -> tuple[int, int, list[dict[str, object]]]:
    _raise_if_cancelled(cancel_event)
    impacted_blindtests = blindtest_repository.list_blindtests_impacted_by_song_ids(
        [int(song["id"]) for song in missing_songs]
    )
    broken_slots = 0
    for song in missing_songs:
        _raise_if_cancelled(cancel_event)
        broken_for_song = blindtest_repository.mark_song_slots_missing(song)
        broken_slots += broken_for_song
        if broken_for_song:
            logger.info("blindtest slot marked missing: %s", song["id"])

    _raise_if_cancelled(cancel_event)
    removed = delete_songs_by_ids([int(song["id"]) for song in missing_songs])
    if removed:
        logger.info("song removed: %s", removed)
    return removed, broken_slots, impacted_blindtests


def _can_skip_known_file(
    existing_song: dict[str, object] | None,
    stat_result: os.stat_result,
) -> bool:
    if existing_song is None:
        return False

    stored_size = existing_song.get("file_size")
    stored_mtime_ns = existing_song.get("file_mtime_ns")
    if stored_size is None or stored_mtime_ns is None:
        return False

    return (
        int(stored_size) == stat_result.st_size
        and int(stored_mtime_ns) == stat_result.st_mtime_ns
    )
