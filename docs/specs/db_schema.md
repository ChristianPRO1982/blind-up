# BlindUp — Database Schema Specification

This document defines the **SQLite database schema** used by the BlindUp application.

The database stores:

* the music library
* blindtests
* song configuration inside blindtests
* gameplay settings

The schema is intentionally simple and optimized for **local usage**.

---

# Entity Overview

```text id="entities_overview"
songs
blindtests
blindtest_tags
blindtest_tag_links
blindtest_songs
```

Relationships:

```text id="relationships_overview"
songs 1 ── n blindtest_songs
blindtests 1 ── n blindtest_songs
blindtests n ── n blindtest_tags
```

---

# Table: songs

Stores songs discovered in the music library.

```sql id="songs_table"
CREATE TABLE songs (
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
```

### Fields

| Field        | Description                    |
| ------------ | ------------------------------ |
| id           | internal identifier            |
| file_hash    | hash used to identify the file |
| file_path    | absolute path to audio file    |
| duration_sec | full song duration             |
| title        | extracted tag                  |
| artist       | extracted tag                  |
| album        | extracted tag                  |
| year         | extracted tag                  |
| genre        | extracted tag                  |
| cover_path   | optional extracted cover       |
| created_at   | creation timestamp             |
| updated_at   | update timestamp               |

---

# Table: blindtests

Stores blindtest definitions.

```sql id="blindtests_table"
CREATE TABLE blindtests (
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
```

### Fields

| Field                   | Description               |
| ----------------------- | ------------------------- |
| title                   | blindtest name            |
| background_image        | selected background       |
| game_mode               | blindtest or blindup      |
| pre_play_delay_sec      | delay before teaser       |
| auto_enabled_default    | default auto mode         |
| hints_enabled_default   | default hints visibility  |
| answer_timer_enabled    | enable answer timer       |
| answer_duration_sec     | answer timer duration     |
| round3_step_durations   | comma separated list      |
| round3_step_gap_sec     | delay between steps       |
| round3_progression_mode | fixed_start or continuous |

---

# Table: blindtest_tags

Tags used to categorize blindtests.

```sql id="blindtest_tags_table"
CREATE TABLE blindtest_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL
);
```

Example tags:

```text id="tags_examples"
Disney
Scout
80s
Rock
```

---

# Table: blindtest_tag_links

Many-to-many relationship between blindtests and tags.

```sql id="blindtest_tag_links_table"
CREATE TABLE blindtest_tag_links (
    blindtest_id INTEGER,
    tag_id INTEGER,
    PRIMARY KEY (blindtest_id, tag_id)
);
```

---

# Table: blindtest_songs

Stores the configuration of songs inside a blindtest.

```sql id="blindtest_songs_table"
CREATE TABLE blindtest_songs (
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

    custom_hint TEXT
);
```

### Fields

| Field        | Description            |
| ------------ | ---------------------- |
| blindtest_id | reference to blindtest |
| song_id      | reference to song      |
| order_index  | order used in round 1  |
| start_sec    | teaser start           |
| duration_sec | teaser duration        |
| override_*   | metadata overrides     |
| custom_hint  | optional hint          |

---

# Indexes

Indexes improve lookup performance.

```sql id="indexes_sql"
CREATE INDEX idx_song_hash ON songs(file_hash);
CREATE INDEX idx_song_path ON songs(file_path);

CREATE INDEX idx_blindtest_song_order
ON blindtest_songs(blindtest_id, order_index);
```

---

# Data Flow

Typical flow:

### Library scan

```text id="scan_flow"
filesystem → metadata extraction → songs table
```

### Blindtest creation

```text id="creation_flow"
songs → blindtest_songs
```

### Gameplay

```text id="gameplay_flow"
blindtest → blindtest_songs → songs
```

---

# Constraints

The database enforces several constraints:

* `file_hash` must be unique
* blindtest songs must reference valid songs
* blindtest tags must be unique

---

# Future Extensions

Possible schema extensions:

* playlists
* statistics
* scoring system
* multiplayer support

These features are **not required** in the current version.

---
