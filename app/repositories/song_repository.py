from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

from app.db import get_connection
from app.services.media_path_service import import_image_reference


@dataclass(frozen=True)
class SongRecord:
    file_hash: str
    file_path: str
    file_size: int | None
    file_mtime_ns: int | None
    duration_sec: float | None
    title: str | None
    artist: str | None
    album: str | None
    year: int | None
    genre: str | None
    cover_path: str | None


def _timestamp() -> str:
    return datetime.now(UTC).isoformat()


def get_song_by_hash(file_hash: str) -> dict[str, object] | None:
    with get_connection() as connection:
        row = connection.execute(
            "SELECT * FROM songs WHERE file_hash = ?;",
            (file_hash,),
        ).fetchone()
    return dict(row) if row is not None else None


def get_song_by_id(song_id: int) -> dict[str, object] | None:
    with get_connection() as connection:
        row = connection.execute(
            "SELECT * FROM songs WHERE id = ?;",
            (song_id,),
        ).fetchone()
    return dict(row) if row is not None else None


def list_songs() -> list[dict[str, object]]:
    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT *
            FROM songs
            ORDER BY COALESCE(title, file_path), id;
            """
        ).fetchall()
    return [dict(row) for row in rows]


def get_song_scan_index() -> dict[str, dict[str, object]]:
    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT *
            FROM songs
            ORDER BY id;
            """
        ).fetchall()
    return {str(row["file_path"]): dict(row) for row in rows}


def normalize_song_media_paths() -> int:
    updated = 0
    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT id, cover_path
            FROM songs
            WHERE cover_path IS NOT NULL AND cover_path != '';
            """
        ).fetchall()
        for row in rows:
            normalized = import_image_reference(str(row["cover_path"]), "covers")
            if normalized == row["cover_path"]:
                continue
            connection.execute(
                """
                UPDATE songs
                SET cover_path = ?,
                    updated_at = ?
                WHERE id = ?;
                """,
                (normalized, _timestamp(), row["id"]),
            )
            updated += 1
    return updated


def upsert_song(song: SongRecord) -> str:
    now = _timestamp()
    existing = get_song_by_hash(song.file_hash)
    payload = (
        song.file_path,
        song.file_size,
        song.file_mtime_ns,
        song.duration_sec,
        song.title,
        song.artist,
        song.album,
        song.year,
        song.genre,
        song.cover_path,
        now,
        song.file_hash,
    )
    with get_connection() as connection:
        if existing is None:
            connection.execute(
                """
                INSERT INTO songs (
                    file_hash,
                    file_path,
                    file_size,
                    file_mtime_ns,
                    duration_sec,
                    title,
                    artist,
                    album,
                    year,
                    genre,
                    cover_path,
                    created_at,
                    updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
                """,
                (
                    song.file_hash,
                    song.file_path,
                    song.file_size,
                    song.file_mtime_ns,
                    song.duration_sec,
                    song.title,
                    song.artist,
                    song.album,
                    song.year,
                    song.genre,
                    song.cover_path,
                    now,
                    now,
                ),
            )
            return "added"

        connection.execute(
            """
            UPDATE songs
            SET file_path = ?,
                file_size = ?,
                file_mtime_ns = ?,
                duration_sec = ?,
                title = ?,
                artist = ?,
                album = ?,
                year = ?,
                genre = ?,
                cover_path = ?,
                updated_at = ?
            WHERE file_hash = ?;
            """,
            payload,
        )
    return "updated"


def list_songs_missing_from(scan_hashes: set[str]) -> list[dict[str, object]]:
    with get_connection() as connection:
        if scan_hashes:
            placeholders = ", ".join("?" for _ in scan_hashes)
            rows = connection.execute(
                (
                    "SELECT * FROM songs "
                    f"WHERE file_hash NOT IN ({placeholders}) "
                    "ORDER BY id;"
                ),
                tuple(sorted(scan_hashes)),
            ).fetchall()
        else:
            rows = connection.execute("SELECT * FROM songs ORDER BY id;").fetchall()
    return [dict(row) for row in rows]


def delete_songs_by_ids(song_ids: list[int]) -> int:
    if not song_ids:
        return 0

    placeholders = ", ".join("?" for _ in song_ids)
    with get_connection() as connection:
        cursor = connection.execute(
            f"DELETE FROM songs WHERE id IN ({placeholders});",
            tuple(song_ids),
        )
    return cursor.rowcount


def delete_songs_missing_from(scan_hashes: set[str]) -> int:
    return delete_songs_by_ids(
        [int(song["id"]) for song in list_songs_missing_from(scan_hashes)]
    )
