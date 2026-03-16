from __future__ import annotations

import logging
import os
from pathlib import Path

from app.config import settings
from app.repositories import song_repository
from app.services.audio_metadata_service import compute_file_hash, is_supported_audio_file

logger = logging.getLogger(__name__)


def resolve_song_file_path(song: dict[str, object]) -> Path | None:
    stored_path = Path(str(song.get("file_path") or "")).expanduser()
    if stored_path.is_file():
        return stored_path

    matched_path = _find_matching_library_file(song)
    if matched_path is None:
        return None

    song_id = song.get("id")
    if song_id is not None:
        stat_result = matched_path.stat()
        song_repository.update_song_file_location(
            int(song_id),
            str(matched_path),
            stat_result.st_size,
            stat_result.st_mtime_ns,
        )

    return matched_path


def _find_matching_library_file(song: dict[str, object]) -> Path | None:
    file_hash = str(song.get("file_hash") or "").strip()
    if file_hash == "":
        return None

    library_root = settings.library_root_path.expanduser().resolve()
    if not library_root.exists() or not library_root.is_dir():
        return None

    stored_name = Path(str(song.get("file_path") or "")).name
    checked_paths: set[str] = set()
    if stored_name:
        for candidate in sorted(library_root.rglob(stored_name)):
            resolved_candidate = candidate.resolve()
            if not is_supported_audio_file(resolved_candidate):
                continue
            checked_paths.add(str(resolved_candidate))
            if _matches_hash(resolved_candidate, file_hash):
                return resolved_candidate

    for candidate in _iter_library_audio_files(library_root):
        if str(candidate) in checked_paths:
            continue
        if _matches_hash(candidate, file_hash):
            return candidate

    return None


def _iter_library_audio_files(root: Path):
    paths: list[Path] = []
    for current_root, dirnames, filenames in os.walk(root):
        dirnames.sort()
        for filename in filenames:
            candidate = (Path(current_root) / filename).resolve()
            if is_supported_audio_file(candidate):
                paths.append(candidate)

    for path in sorted(paths):
        yield path


def _matches_hash(path: Path, expected_hash: str) -> bool:
    try:
        return compute_file_hash(path) == expected_hash
    except OSError as exc:
        logger.warning("could not hash %s while resolving song path: %s", path, exc)
        return False
