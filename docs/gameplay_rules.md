# BlindUp — Gameplay Rules

This document describes the **runtime behavior of the BlindUp game engine**.

It defines:

* panel transitions
* `La la la...` playback behavior
* hint logic
* timers
* host controls

These rules apply during a running blindtest session.

---

# Game Session Structure

A game session consists of:

1. Waiting panel
2. One or more rounds
3. End panel

The number of rounds depends on the selected game mode.

| Mode       | Rounds                      |
| ---------- | --------------------------- |
| Blind Test | Round 1 only                |
| BlindUp    | Round 1 + Round 2 + Round 3 |

---

# Panel Types

During gameplay the application displays several panels.

## Waiting Panel

Displayed before the game starts.

Content:

* blindtest title
* background image

The host starts the game manually.

---

## Round Transition Panel

Displayed between rounds in **BlindUp mode**.

Example panels:

* "Round 2 — Reverse"
* "Round 3 — Escalation"

These panels inform players of the rule change.

The host advances manually.

---

## La la la... Panel

The `La la la...` panel plays a song excerpt.

Elements displayed:

* background image
* optional hints
* optional timer
* control buttons

Playback begins after the **pre-play delay**.

The `La la la...` audio plays **once**.

---

## Answer Panel

The answer panel reveals the correct information.

Displayed elements:

* title
* artist
* album
* year
* genre
* cover image

Playback behavior depends on the round.

---

## End Panel

Displayed after the last song.

Content:

```id="end_panel_text"
BLINDUP
```

---

# Round Behaviors

## Round 1 — Classic Blind Test

Songs are played in the order defined by the blindtest.

### La la la...

The `La la la...` segment is defined by:

```id="round1_segment"
start_sec
duration_sec
```

Playback:

```id="round1_playback"
play(start_sec → start_sec + duration_sec)
```

### Answer

The **full song** is played.

---

## Round 2 — Reverse Round

Songs are played in **random order**.

### La la la...

The same segment as round 1 is used.

The audio is reversed.

```id="round2_reverse_segment"
segment = [start_sec → start_sec + duration_sec]
reverse(segment)
play(segment)
```

### Answer

The **same segment** is played normally.

The full song is **not** played.

---

## Round 3 — Escalation Round

Songs are played in **random order**.

The `La la la...` duration increases progressively.

Example preset:

```id="round3_durations"
0.5
1
1.5
2
3
4
5
```

Each step plays a `La la la...` excerpt of increasing duration.

---

# Round 3 Progression Modes

## Fixed Start

Each `La la la...` excerpt starts from `start_sec`.

```id="round3_fixed_example"
start_sec = 60

0.5s → 60 → 60.5
1s → 60 → 61
2s → 60 → 62
```

---

## Continuous

Each `La la la...` excerpt continues from the previous end position.

```id="round3_continuous_example"
start_sec = 60

0.5s → 60 → 60.5
1s → 60.5 → 61.5
2s → 61.5 → 63.5
```

---

# Hint System

Hints appear during `La la la...` playback.

Possible hints:

* custom hint
* year
* genre
* album
* cover
* artist

Hints appear every **5 seconds**.

---

## Hint Availability by Round

| Round   | Hints            |
| ------- | ---------------- |
| Round 1 | All hints        |
| Round 2 | Custom hint only |
| Round 3 | No hints         |

---

# Hint Visibility

Hints are generated internally but may be hidden.

If hints are hidden:

* hint timing continues
* when hints are enabled again, all elapsed hints appear immediately

---

# Automatic Mode

BlindUp supports an **Auto mode**.

When enabled:

* `La la la...` → answer transitions occur automatically
* answer → next song transitions occur automatically

Answer panels use a configurable timer.

Example:

```id="answer_timer_example"
10 seconds
```

---

# Round 3 Auto Behavior

When Auto mode is enabled during round 3:

* `La la la...` steps progress automatically
* a pause occurs between steps

Example:

```id="round3_auto_sequence"
0.5s play
3s pause
1s play
3s pause
1.5s play
...
```

After the last step the game transitions to the answer panel.

---

# Host Controls

The host can control the game using keyboard shortcuts.

| Action               | Keys                            |
| -------------------- | ------------------------------- |
| Next panel           | Space / ArrowRight / ArrowDown  |
| Previous panel       | ArrowLeft / ArrowUp / Backspace |
| Toggle hints         | Escape / I                      |
| Toggle auto mode     | A                               |
| Next escalation step | D                               |

---

# Manual Controls

All gameplay panels include visible control buttons.

The host may use either:

* keyboard shortcuts
* mouse interaction

Buttons are designed to remain **visually discreet** to avoid distracting the audience.

---

# Error Handling

If a song cannot be played the `La la la...` panel displays:

```id="error_text"
Schrouunntch
```

The host can skip to the next panel.

---

# Gameplay Philosophy

BlindUp focuses on:

* fast-paced gameplay
* minimal interruptions
* host-controlled pacing

The interface is designed to allow the host to **recover quickly from mistakes or technical issues**.
