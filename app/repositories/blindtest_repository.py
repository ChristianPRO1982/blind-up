from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from app.db import get_connection
from app.services.media_path_service import import_image_reference


@dataclass(frozen=True)
class BlindtestSongRecord:
    song_id: int | None
    order_index: int
    slot_status: str = "ok"
    start_sec: float | None = None
    duration_sec: float | None = None
    source_title: str | None = None
    source_artist: str | None = None
    source_album: str | None = None
    source_year: int | None = None
    source_genre: str | None = None
    source_cover: str | None = None
    override_title: str | None = None
    override_artist: str | None = None
    override_album: str | None = None
    override_year: int | None = None
    override_genre: str | None = None
    override_cover: str | None = None
    custom_hint: str | None = None


@dataclass(frozen=True)
class BlindtestRecord:
    id: int | None = None
    title: str = ""
    background_image: str | None = None
    game_mode: str = "blind_test"
    pre_play_delay_sec: float = 0.0
    auto_enabled_default: bool = False
    hints_enabled_default: bool = True
    answer_timer_enabled: bool = False
    answer_duration_sec: float = 10.0
    round3_step_durations: str = "0.5,1,1.5,2,3,4,5"
    round3_step_gap_sec: float = 3.0
    round3_progression_mode: str = "fixed_start"
    songs: list[BlindtestSongRecord] = field(default_factory=list)


def _timestamp() -> str:
    return datetime.now(UTC).isoformat()


def _snapshot_from_song(song: dict[str, object] | None) -> dict[str, object | None]:
    if song is None:
        return {
            "source_title": None,
            "source_artist": None,
            "source_album": None,
            "source_year": None,
            "source_genre": None,
            "source_cover": None,
        }

    return {
        "source_title": song["title"],
        "source_artist": song["artist"],
        "source_album": song["album"],
        "source_year": song["year"],
        "source_genre": song["genre"],
        "source_cover": song["cover_path"],
    }


def get_blindtest(blindtest_id: int) -> dict[str, object] | None:
    with get_connection() as connection:
        blindtest_row = connection.execute(
            """
            SELECT *
            FROM blindtests
            WHERE id = ?;
            """,
            (blindtest_id,),
        ).fetchone()
        if blindtest_row is None:
            return None

        song_rows = connection.execute(
            """
            SELECT *
            FROM blindtest_songs
            WHERE blindtest_id = ?
            ORDER BY order_index, id;
            """,
            (blindtest_id,),
        ).fetchall()

    blindtest = dict(blindtest_row)
    blindtest["songs"] = [dict(row) for row in song_rows]
    return blindtest


def list_blindtests() -> list[dict[str, object]]:
    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT id, title, updated_at
            FROM blindtests
            ORDER BY updated_at DESC, id DESC;
            """
        ).fetchall()
    return [dict(row) for row in rows]


def list_blindtests_impacted_by_song_ids(
    song_ids: list[int],
) -> list[dict[str, object]]:
    if not song_ids:
        return []

    placeholders = ", ".join("?" for _ in song_ids)
    with get_connection() as connection:
        rows = connection.execute(
            f"""
            SELECT DISTINCT blindtests.id, blindtests.title
            FROM blindtests
            INNER JOIN blindtest_songs ON blindtest_songs.blindtest_id = blindtests.id
            WHERE blindtest_songs.song_id IN ({placeholders})
            ORDER BY blindtests.updated_at DESC, blindtests.id DESC;
            """,
            tuple(song_ids),
        ).fetchall()
    return [dict(row) for row in rows]


def normalize_blindtest_media(blindtest_id: int) -> int:
    updated = 0
    with get_connection() as connection:
        blindtest_row = connection.execute(
            """
            SELECT id, background_image
            FROM blindtests
            WHERE id = ?;
            """,
            (blindtest_id,),
        ).fetchone()
        if blindtest_row is not None:
            normalized_background = import_image_reference(
                blindtest_row["background_image"],
                "backgrounds",
            )
            if normalized_background != blindtest_row["background_image"]:
                connection.execute(
                    """
                    UPDATE blindtests
                    SET background_image = ?,
                        updated_at = ?
                    WHERE id = ?;
                    """,
                    (normalized_background, _timestamp(), blindtest_id),
                )
                updated += 1

        slot_rows = connection.execute(
            """
            SELECT id, source_cover, override_cover
            FROM blindtest_songs
            WHERE blindtest_id = ?;
            """,
            (blindtest_id,),
        ).fetchall()
        for row in slot_rows:
            normalized_source = import_image_reference(row["source_cover"], "covers")
            normalized_override = import_image_reference(
                row["override_cover"],
                "covers",
            )
            if (
                normalized_source == row["source_cover"]
                and normalized_override == row["override_cover"]
            ):
                continue
            connection.execute(
                """
                UPDATE blindtest_songs
                SET source_cover = ?,
                    override_cover = ?
                WHERE id = ?;
                """,
                (normalized_source, normalized_override, row["id"]),
            )
            updated += 1
    return updated


def validate_blindtest_links(blindtest_id: int) -> dict[str, int]:
    validated_slots = 0
    missing_slots = 0

    with get_connection() as connection:
        slot_rows = connection.execute(
            """
            SELECT
                blindtest_songs.id,
                blindtest_songs.song_id,
                blindtest_songs.slot_status,
                blindtest_songs.source_title,
                blindtest_songs.source_artist,
                blindtest_songs.source_album,
                blindtest_songs.source_year,
                blindtest_songs.source_genre,
                blindtest_songs.source_cover,
                songs.title,
                songs.artist,
                songs.album,
                songs.year,
                songs.genre,
                songs.cover_path,
                songs.file_path
            FROM blindtest_songs
            LEFT JOIN songs ON blindtest_songs.song_id = songs.id
            WHERE blindtest_songs.blindtest_id = ?
            ORDER BY blindtest_songs.order_index, blindtest_songs.id;
            """,
            (blindtest_id,),
        ).fetchall()

        for row in slot_rows:
            validated_slots += 1
            song_id = row["song_id"]
            if song_id is None:
                if row["slot_status"] != "missing":
                    connection.execute(
                        """
                        UPDATE blindtest_songs
                        SET slot_status = ?
                        WHERE id = ?;
                        """,
                        ("missing", row["id"]),
                    )
                continue

            file_path = row["file_path"]
            linked_row_exists = file_path is not None
            file_exists = linked_row_exists and Path(str(file_path)).is_file()
            if linked_row_exists and file_exists:
                continue

            missing_slots += 1
            snapshot = _snapshot_from_song(dict(row) if linked_row_exists else None)
            connection.execute(
                """
                UPDATE blindtest_songs
                SET song_id = NULL,
                    slot_status = ?,
                    source_title = COALESCE(?, source_title),
                    source_artist = COALESCE(?, source_artist),
                    source_album = COALESCE(?, source_album),
                    source_year = COALESCE(?, source_year),
                    source_genre = COALESCE(?, source_genre),
                    source_cover = COALESCE(?, source_cover)
                WHERE id = ?;
                """,
                (
                    "missing",
                    snapshot["source_title"],
                    snapshot["source_artist"],
                    snapshot["source_album"],
                    snapshot["source_year"],
                    snapshot["source_genre"],
                    snapshot["source_cover"],
                    row["id"],
                ),
            )

    return {
        "validated_slots": validated_slots,
        "missing_slots": missing_slots,
    }


def mark_song_slots_missing(song: dict[str, object]) -> int:
    snapshot = _snapshot_from_song(song)
    with get_connection() as connection:
        cursor = connection.execute(
            """
            UPDATE blindtest_songs
            SET song_id = NULL,
                slot_status = ?,
                source_title = COALESCE(source_title, ?),
                source_artist = COALESCE(source_artist, ?),
                source_album = COALESCE(source_album, ?),
                source_year = COALESCE(source_year, ?),
                source_genre = COALESCE(source_genre, ?),
                source_cover = COALESCE(source_cover, ?)
            WHERE song_id = ?;
            """,
            (
                "missing",
                snapshot["source_title"],
                snapshot["source_artist"],
                snapshot["source_album"],
                snapshot["source_year"],
                snapshot["source_genre"],
                snapshot["source_cover"],
                song["id"],
            ),
        )
    return cursor.rowcount


def save_blindtest(record: BlindtestRecord) -> dict[str, object]:
    now = _timestamp()
    with get_connection() as connection:
        blindtest_id = record.id
        normalized_background = import_image_reference(
            record.background_image,
            "backgrounds",
        )
        if blindtest_id is None:
            cursor = connection.execute(
                """
                INSERT INTO blindtests (
                    title,
                    background_image,
                    game_mode,
                    pre_play_delay_sec,
                    auto_enabled_default,
                    hints_enabled_default,
                    answer_timer_enabled,
                    answer_duration_sec,
                    round3_step_durations,
                    round3_step_gap_sec,
                    round3_progression_mode,
                    created_at,
                    updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
                """,
                (
                    record.title,
                    normalized_background,
                    record.game_mode,
                    record.pre_play_delay_sec,
                    int(record.auto_enabled_default),
                    int(record.hints_enabled_default),
                    int(record.answer_timer_enabled),
                    record.answer_duration_sec,
                    record.round3_step_durations,
                    record.round3_step_gap_sec,
                    record.round3_progression_mode,
                    now,
                    now,
                ),
            )
            blindtest_id = int(cursor.lastrowid)
        else:
            connection.execute(
                """
                UPDATE blindtests
                SET title = ?,
                    background_image = ?,
                    game_mode = ?,
                    pre_play_delay_sec = ?,
                    auto_enabled_default = ?,
                    hints_enabled_default = ?,
                    answer_timer_enabled = ?,
                    answer_duration_sec = ?,
                    round3_step_durations = ?,
                    round3_step_gap_sec = ?,
                    round3_progression_mode = ?,
                    updated_at = ?
                WHERE id = ?;
                """,
                (
                    record.title,
                    normalized_background,
                    record.game_mode,
                    record.pre_play_delay_sec,
                    int(record.auto_enabled_default),
                    int(record.hints_enabled_default),
                    int(record.answer_timer_enabled),
                    record.answer_duration_sec,
                    record.round3_step_durations,
                    record.round3_step_gap_sec,
                    record.round3_progression_mode,
                    now,
                    blindtest_id,
                ),
            )
            connection.execute(
                """
                DELETE FROM blindtest_songs
                WHERE blindtest_id = ?;
                """,
                (blindtest_id,),
            )

        for song in record.songs:
            source_song = None
            if song.song_id is not None:
                source_song = connection.execute(
                    """
                    SELECT title, artist, album, year, genre, cover_path
                    FROM songs
                    WHERE id = ?;
                    """,
                    (song.song_id,),
                ).fetchone()
            snapshot = _snapshot_from_song(
                dict(source_song) if source_song is not None else None
            )
            song_id = song.song_id if source_song is not None else None
            slot_status = "ok" if song_id is not None else "missing"
            source_cover = import_image_reference(
                (song.source_cover if song_id is None else snapshot["source_cover"]),
                "covers",
            )
            override_cover = import_image_reference(song.override_cover, "covers")
            connection.execute(
                """
                INSERT INTO blindtest_songs (
                    blindtest_id,
                    song_id,
                    order_index,
                    slot_status,
                    start_sec,
                    duration_sec,
                    source_title,
                    source_artist,
                    source_album,
                    source_year,
                    source_genre,
                    source_cover,
                    override_title,
                    override_artist,
                    override_album,
                    override_year,
                    override_genre,
                    override_cover,
                    custom_hint
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
                """,
                (
                    blindtest_id,
                    song_id,
                    song.order_index,
                    slot_status,
                    song.start_sec,
                    song.duration_sec,
                    (
                        song.source_title
                        if song_id is None
                        else snapshot["source_title"]
                    ),
                    (
                        song.source_artist
                        if song_id is None
                        else snapshot["source_artist"]
                    ),
                    (
                        song.source_album
                        if song_id is None
                        else snapshot["source_album"]
                    ),
                    (song.source_year if song_id is None else snapshot["source_year"]),
                    (
                        song.source_genre
                        if song_id is None
                        else snapshot["source_genre"]
                    ),
                    (source_cover),
                    song.override_title,
                    song.override_artist,
                    song.override_album,
                    song.override_year,
                    song.override_genre,
                    override_cover,
                    song.custom_hint,
                ),
            )

    return get_blindtest(blindtest_id) or {}
