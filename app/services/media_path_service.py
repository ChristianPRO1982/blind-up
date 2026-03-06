from __future__ import annotations

import hashlib
import shutil
from pathlib import Path

from app.config import settings


def is_public_media_reference(value: str | None) -> bool:
    if not value:
        return False
    return value.startswith(("/media/", "/static/", "http://", "https://"))


def build_media_url(category: str, filename: str) -> str:
    return f"/media/{category}/{filename}"


def import_image_reference(value: str | None, category: str) -> str | None:
    if value is None:
        return None

    normalized = value.strip()
    if not normalized:
        return None
    if is_public_media_reference(normalized):
        return normalized

    source_path = Path(normalized).expanduser()
    if not source_path.is_file():
        return normalized

    digest = hashlib.sha256(source_path.read_bytes()).hexdigest()
    suffix = source_path.suffix.lower()
    target_dir = settings.storage_dir / category
    target_dir.mkdir(parents=True, exist_ok=True)
    target_path = target_dir / f"{digest}{suffix}"
    if not target_path.exists():
        shutil.copy2(source_path, target_path)
    return build_media_url(category, target_path.name)
