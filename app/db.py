import sqlite3

from app.config import settings

SCHEMA_SCRIPT = """
CREATE TABLE IF NOT EXISTS songs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_hash TEXT UNIQUE NOT NULL,
    file_path TEXT NOT NULL,
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

CREATE TABLE IF NOT EXISTS blindtest_songs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    blindtest_id INTEGER NOT NULL,
    song_id INTEGER NOT NULL,
    order_index INTEGER,
    start_sec REAL,
    duration_sec REAL,
    override_title TEXT,
    override_artist TEXT,
    override_album TEXT,
    override_year INTEGER,
    override_genre TEXT,
    override_cover TEXT,
    custom_hint TEXT,
    FOREIGN KEY (blindtest_id) REFERENCES blindtests(id),
    FOREIGN KEY (song_id) REFERENCES songs(id)
);

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


def init_db() -> None:
    with get_connection() as connection:
        connection.executescript(SCHEMA_SCRIPT)
