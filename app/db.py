import sqlite3

from app.config import settings

DEFAULT_SLOT_STATUS_SQL = (
    "CASE WHEN blindtest_songs_legacy.song_id IS NULL THEN 'missing' ELSE 'ok' END"
)

SONGS_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS songs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_hash TEXT UNIQUE NOT NULL,
    file_path TEXT NOT NULL,
    file_size INTEGER,
    file_mtime_ns INTEGER,
    duration_sec REAL,
    title TEXT,
    artist TEXT,
    album TEXT,
    year INTEGER,
    genre TEXT,
    cover_path TEXT,
    created_at TEXT,
    updated_at TEXT
);
"""

SONGS_SCAN_COLUMNS = [
    "file_size",
    "file_mtime_ns",
]

BLINDTEST_SONGS_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS blindtest_songs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    blindtest_id INTEGER NOT NULL,
    song_id INTEGER,
    order_index INTEGER,
    slot_status TEXT,
    start_sec REAL,
    duration_sec REAL,
    source_title TEXT,
    source_artist TEXT,
    source_album TEXT,
    source_year INTEGER,
    source_genre TEXT,
    source_background TEXT,
    override_title TEXT,
    override_artist TEXT,
    override_album TEXT,
    override_year INTEGER,
    override_genre TEXT,
    override_background TEXT,
    custom_hint TEXT,
    FOREIGN KEY (blindtest_id) REFERENCES blindtests(id),
    FOREIGN KEY (song_id) REFERENCES songs(id)
);
"""

BLINDTEST_SONGS_COLUMNS = [
    "id",
    "blindtest_id",
    "song_id",
    "order_index",
    "slot_status",
    "start_sec",
    "duration_sec",
    "source_title",
    "source_artist",
    "source_album",
    "source_year",
    "source_genre",
    "source_background",
    "override_title",
    "override_artist",
    "override_album",
    "override_year",
    "override_genre",
    "override_background",
    "custom_hint",
]

SCHEMA_SCRIPT = f"""
{SONGS_TABLE_SQL}
CREATE TABLE IF NOT EXISTS blindtests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    background_image TEXT,
    game_mode TEXT,
    pre_play_delay_sec REAL,
    auto_enabled_default INTEGER,
    hints_enabled_default INTEGER,
    answer_timer_enabled INTEGER,
    answer_duration_sec REAL,
    round3_step_durations TEXT,
    round3_step_gap_sec REAL,
    round3_progression_mode TEXT,
    created_at TEXT,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS blindtest_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS blindtest_tag_links (
    blindtest_id INTEGER,
    tag_id INTEGER,
    PRIMARY KEY (blindtest_id, tag_id),
    FOREIGN KEY (blindtest_id) REFERENCES blindtests(id),
    FOREIGN KEY (tag_id) REFERENCES blindtest_tags(id)
);

{BLINDTEST_SONGS_TABLE_SQL}

CREATE INDEX IF NOT EXISTS idx_song_hash ON songs(file_hash);
CREATE INDEX IF NOT EXISTS idx_song_path ON songs(file_path);
CREATE INDEX IF NOT EXISTS idx_blindtest_song_order
ON blindtest_songs(blindtest_id, order_index);
"""


def get_connection() -> sqlite3.Connection:
    settings.database_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(settings.database_path)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON;")
    return connection


def _songs_missing_columns(connection: sqlite3.Connection) -> list[str]:
    columns = connection.execute("PRAGMA table_info(songs);").fetchall()
    if not columns:
        return []

    column_names = {row["name"] for row in columns}
    return [name for name in SONGS_SCAN_COLUMNS if name not in column_names]


def _migrate_songs(connection: sqlite3.Connection) -> None:
    for column_name in _songs_missing_columns(connection):
        connection.execute(f"ALTER TABLE songs ADD COLUMN {column_name} INTEGER;")


def _blindtest_songs_needs_migration(connection: sqlite3.Connection) -> bool:
    columns = connection.execute("PRAGMA table_info(blindtest_songs);").fetchall()
    if not columns:
        return False

    column_names = [row["name"] for row in columns]
    if column_names != BLINDTEST_SONGS_COLUMNS:
        return True

    song_id_column = next(
        (row for row in columns if row["name"] == "song_id"),
        None,
    )
    return song_id_column is not None and int(song_id_column["notnull"]) == 1


def _migrate_blindtest_songs(connection: sqlite3.Connection) -> None:
    original_columns = [
        row["name"] for row in connection.execute("PRAGMA table_info(blindtest_songs);")
    ]
    if not original_columns:
        return

    connection.execute("DROP TABLE IF EXISTS blindtest_songs_legacy;")

    connection.execute("ALTER TABLE blindtest_songs RENAME TO blindtest_songs_legacy;")
    connection.execute(BLINDTEST_SONGS_TABLE_SQL)

    def has_column(name: str) -> bool:
        return name in original_columns

    def select_column(name: str, fallback: str) -> str:
        return f"blindtest_songs_legacy.{name}" if has_column(name) else fallback

    def select_slot_background(column_name: str) -> str:
        if has_column(column_name):
            return f"blindtest_songs_legacy.{column_name}"
        legacy_name = column_name.replace("_background", "_cover")
        if has_column(legacy_name):
            return f"blindtest_songs_legacy.{legacy_name}"
        return "NULL"

    join_clause = ""
    if has_column("song_id"):
        join_clause = "LEFT JOIN songs ON blindtest_songs_legacy.song_id = songs.id"

    connection.execute(
        f"""
        INSERT INTO blindtest_songs (
            id,
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
            source_background,
            override_title,
            override_artist,
            override_album,
            override_year,
            override_genre,
            override_background,
            custom_hint
        )
        SELECT
            blindtest_songs_legacy.id,
            blindtest_songs_legacy.blindtest_id,
            {select_column("song_id", "NULL")},
            blindtest_songs_legacy.order_index,
            {select_column("slot_status", DEFAULT_SLOT_STATUS_SQL)},
            blindtest_songs_legacy.start_sec,
            blindtest_songs_legacy.duration_sec,
            {select_column("source_title", "songs.title")},
            {select_column("source_artist", "songs.artist")},
            {select_column("source_album", "songs.album")},
            {select_column("source_year", "songs.year")},
            {select_column("source_genre", "songs.genre")},
            {select_slot_background("source_background")},
            blindtest_songs_legacy.override_title,
            blindtest_songs_legacy.override_artist,
            blindtest_songs_legacy.override_album,
            blindtest_songs_legacy.override_year,
            blindtest_songs_legacy.override_genre,
            {select_slot_background("override_background")},
            blindtest_songs_legacy.custom_hint
        FROM blindtest_songs_legacy
        {join_clause};
        """
    )
    connection.execute("DROP TABLE blindtest_songs_legacy;")
    connection.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_blindtest_song_order
        ON blindtest_songs(blindtest_id, order_index);
        """
    )


def init_db() -> None:
    with get_connection() as connection:
        connection.executescript(SCHEMA_SCRIPT)
        if _songs_missing_columns(connection):
            _migrate_songs(connection)
        if _blindtest_songs_needs_migration(connection):
            _migrate_blindtest_songs(connection)
