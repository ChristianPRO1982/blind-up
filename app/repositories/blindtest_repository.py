from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime

from app.db import get_connection


@dataclass(frozen=True)
class BlindtestSongRecord:
    song_id: int
    order_index: int
    start_sec: float | None = None
    duration_sec: float | None = None
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


def get_first_blindtest() -> dict[str, object] | None:
    with get_connection() as connection:
        row = connection.execute(
            """
            SELECT id
            FROM blindtests
            ORDER BY id
            LIMIT 1;
            """
        ).fetchone()

    if row is None:
        return None

    return get_blindtest(int(row["id"]))


def save_blindtest(record: BlindtestRecord) -> dict[str, object]:
    now = _timestamp()
    with get_connection() as connection:
        blindtest_id = record.id
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
                    record.background_image,
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
                    record.background_image,
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
            connection.execute(
                """
                INSERT INTO blindtest_songs (
                    blindtest_id,
                    song_id,
                    order_index,
                    start_sec,
                    duration_sec,
                    override_title,
                    override_artist,
                    override_album,
                    override_year,
                    override_genre,
                    override_cover,
                    custom_hint
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
                """,
                (
                    blindtest_id,
                    song.song_id,
                    song.order_index,
                    song.start_sec,
                    song.duration_sec,
                    song.override_title,
                    song.override_artist,
                    song.override_album,
                    song.override_year,
                    song.override_genre,
                    song.override_cover,
                    song.custom_hint,
                ),
            )

    return get_blindtest(blindtest_id) or {}
