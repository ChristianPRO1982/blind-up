from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

from app.db import get_connection


@dataclass(frozen=True)
class SongRecord:
    file_hash: str
    file_path: str
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


def upsert_song(song: SongRecord) -> str:
    now = _timestamp()
    existing = get_song_by_hash(song.file_hash)
    payload = (
        song.file_path,
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
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
                """,
                (
                    song.file_hash,
                    song.file_path,
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


def delete_songs_missing_from(scan_hashes: set[str]) -> int:
    with get_connection() as connection:
        if scan_hashes:
            placeholders = ", ".join("?" for _ in scan_hashes)
            cursor = connection.execute(
                f"DELETE FROM songs WHERE file_hash NOT IN ({placeholders});",
                tuple(sorted(scan_hashes)),
            )
        else:
            cursor = connection.execute("DELETE FROM songs;")
    return cursor.rowcount
