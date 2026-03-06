# BlindUp — Product Specification

## Overview

BlindUp is a **local web application** used to host music quiz sessions.

The game is based on a classic **blind test** but introduces additional rounds inspired by the board game **Time’s Up**.

BlindUp is designed for **single-host usage**:

* one person controls the game
* the audience listens and answers verbally
* there are **no connected players**

The application runs locally and uses a **local music library** provided by the user.

---

# Core Concepts

## Song

A song is an audio file present in the user's music library.

Supported formats include common audio formats such as:

* MP3
* FLAC
* AAC
* M4A

Each song contains metadata extracted from audio tags:

* title
* artist
* album
* year
* genre
* cover image

Songs are identified internally using a **file hash**.

---

## Blindtest

A blindtest is a collection of songs configured for gameplay.

A blindtest defines:

* the order of songs
* teaser segments for each song
* optional metadata overrides
* gameplay parameters

Blindtests are stored in the application database.

---

## Song Configuration in a Blindtest

Each song inside a blindtest defines:

* `start_sec` — starting point of the teaser
* `duration_sec` — teaser duration
* optional metadata overrides
* an optional **custom hint**

Overrides allow modifying displayed metadata without altering the original library data.

Blindtest song slots may remain in place even if the source audio disappears from the library later.

In that case:

* the slot is preserved
* the blindtest keeps the last known source metadata
* the slot is marked as broken and must be repaired manually

---

# Game Modes

BlindUp supports two game modes.

## Blind Test Mode

Only the **first round** is played.

This mode corresponds to a classic blind test.

---

## BlindUp Mode

Three rounds are played using the same songs.

1. Classic round
2. Reverse round
3. Escalation round

Songs in rounds 2 and 3 are played in **random order**.

---

# Round 1 — Classic Blind Test

Songs are played in the order defined by the blindtest creator.

Gameplay:

1. Waiting panel
2. Teaser playback
3. Answer panel

Teaser behaviour:

* playback starts after a configurable delay
* the teaser plays **once**
* the teaser segment is defined by `start_sec` and `duration_sec`

Hints may appear during the teaser.

---

# Round 2 — Reverse Round

Songs are played in **random order**.

Teaser behaviour:

* the same segment as round 1
* audio is **played in reverse**

Answer panel behaviour:

* the same teaser segment is played **normally**
* the full song is not played

Hints:

* only the **custom hint** is allowed
* metadata hints are disabled

---

# Round 3 — Escalation Round

Songs are played in **random order**.

The teaser is played using **progressive durations**.

Example preset:

```id="example_round3_steps"
0.5
1
1.5
2
3
4
5
```

The host can advance the teaser duration manually.

A pause occurs between steps.

The pause duration is configurable.

---

## Round 3 Progression Modes

Two progression modes exist.

### Fixed Start

Each step starts from the same position.

Example:

```id="fixed_start_example"
start_sec = 60

0.5s → 60 → 60.5
1s   → 60 → 61
2s   → 60 → 62
```

---

### Continuous

Steps continue from the previous end position.

Example:

```id="continuous_example"
start_sec = 60

0.5s → 60 → 60.5
1s   → 60.5 → 61.5
2s   → 61.5 → 63.5
```

---

# Hints

Hints may appear progressively during a teaser.

Possible hints:

* custom hint
* year
* genre
* album
* cover
* artist

Hint availability depends on the round:

| Round   | Hints            |
| ------- | ---------------- |
| Round 1 | All hints        |
| Round 2 | Custom hint only |
| Round 3 | No hints         |

Hints appear every **5 seconds** when enabled.

The host can toggle hint visibility during gameplay.

---

# Automatic Transitions

BlindUp supports an **Auto mode**.

When Auto is enabled:

* teaser → answer transitions occur automatically
* answer → next song transitions occur automatically

Answer panels can display a countdown timer.

The timer duration is configurable.

---

# Host Controls

The host can control the game using keyboard shortcuts.

| Action                         | Keys                            |
| ------------------------------ | ------------------------------- |
| Next panel                     | Space / ArrowRight / ArrowDown  |
| Previous panel                 | ArrowLeft / ArrowUp / Backspace |
| Toggle hints                   | Escape / I                      |
| Toggle auto mode               | A                               |
| Next escalation step (round 3) | D                               |

---

# Panels

The application contains several UI panels.

Main panels include:

* Home panel
* Library scan panel
* Blindtest editor panel
* Game player panel

Each panel focuses on a single task.

---

# Library

The music library is located in a **user-defined folder**.

Example:

```id="library_example_path"
/users/moi/music/
```

The application scans this directory recursively.

The scan extracts:

* file hash
* metadata tags
* cover images

The scan can:

* add new songs
* remove missing songs

Manual edits are done inside the application.

---

# Error Handling

If an audio file cannot be played, the application displays:

```id="audio_error_text"
Schrouunntch
```

The host can skip the problematic song.

---

# Design Goals

BlindUp prioritizes:

* simple operation
* fast configuration
* reliable gameplay
* host-friendly controls

The application is intentionally designed to remain **lightweight and predictable**.
