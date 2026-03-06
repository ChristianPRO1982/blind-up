# BlindUp — Blindtest Player Specification

This document defines the **game player panel** responsible for running a blindtest session.

The player controls:

* panel transitions
* teaser playback
* hint timing
* automatic transitions
* round logic

The game engine runs entirely in the **frontend**.

---

# Player Responsibilities

The Blindtest Player must:

* load a blindtest configuration
* iterate through songs
* manage rounds
* control audio playback
* display panels
* handle keyboard controls

The player must remain **fully controllable by the host**.

---

# Player State

The player maintains a game state object.

Example:

```javascript id="player_state_example"
{
  blindtest_id: 1,
  mode: "blindup",

  current_round: 1,
  current_song_index: 0,

  panel: "waiting",

  auto_enabled: false,
  hints_visible: false,

  round3_step_index: 0
}
```

---

# Panel Types

The player displays panels sequentially.

Panels:

* waiting
* round_transition
* teaser
* answer
* end

---

# Waiting Panel

Displayed before the game starts.

Content:

* blindtest title
* background image

The host presses **Next** to begin.

---

# Round Transition Panel

Displayed between rounds in BlindUp mode.

Example:

```text id="round2_text"
Round 2 — Reverse
```

```text id="round3_text"
Round 3 — Escalation
```

The host presses **Next** to continue.

---

# Teaser Panel

Displays the teaser for the current song.

Elements:

* background image
* optional hints
* control buttons
* optional countdown

Audio playback starts after the **pre_play_delay_sec**.

The teaser audio plays **once**.

---

# Answer Panel

Displays the correct answer.

Content:

* title
* artist
* album
* year
* genre
* cover

Playback behavior depends on the round.

---

# End Panel

Displayed after the last song.

Content:

```text id="end_text"
BLINDUP
```

---

# Round Logic

## Round 1 — Classic

Song order:

```text id="round1_order"
defined order
```

Teaser playback:

```text id="round1_play"
start_sec → start_sec + duration_sec
```

Answer playback:

```text id="round1_answer"
full song
```

---

## Round 2 — Reverse

Song order:

```text id="round2_order"
random
```

Teaser playback:

1. load audio buffer
2. extract teaser segment
3. reverse audio
4. play reversed segment

Answer playback:

```text id="round2_answer"
normal teaser segment
```

---

## Round 3 — Escalation

Song order:

```text id="round3_order"
random
```

Teaser durations are defined by:

```text id="round3_steps"
round3_step_durations
```

Example:

```text id="round3_example"
0.5
1
1.5
2
3
4
5
```

---

# Round 3 Step Behavior

The host may manually trigger the next step.

Each step plays the teaser using the configured duration.

---

## Fixed Start Mode

Each step starts from `start_sec`.

Example:

```text id="round3_fixed"
start_sec = 60

step1 → 60 → 60.5
step2 → 60 → 61
step3 → 60 → 61.5
```

---

## Continuous Mode

Each step continues from the previous end.

Example:

```text id="round3_continuous"
start_sec = 60

step1 → 60 → 60.5
step2 → 60.5 → 61.5
step3 → 61.5 → 63
```

---

# Hint System

Hints are internally generated even when hidden.

Hint order:

```text id="hint_order"
custom hint
year
genre
album
cover
artist
```

Hints appear every **5 seconds**.

---

# Hint Availability by Round

| Round   | Hints            |
| ------- | ---------------- |
| Round 1 | All hints        |
| Round 2 | Custom hint only |
| Round 3 | No hints         |

---

# Hint Visibility Toggle

Hints may be hidden or shown.

Behavior:

```text id="hint_toggle_behavior"
hidden → timer continues
visible → show all elapsed hints
```

---

# Automatic Mode

Auto mode controls transitions.

When enabled:

* teaser → answer
* answer → next song

Answer panels use a timer.

Example:

```text id="answer_timer_example"
10 seconds
```

---

# Round 3 Auto Behavior

When auto mode is active:

* teaser steps progress automatically
* pauses occur between steps

Example:

```text id="round3_auto_sequence"
0.5s play
3s pause
1s play
3s pause
1.5s play
```

After the final step the player moves to the answer panel.

---

# Host Controls

The player supports keyboard shortcuts.

| Action               | Keys                            |
| -------------------- | ------------------------------- |
| Next panel           | Space / ArrowRight / ArrowDown  |
| Previous panel       | ArrowLeft / ArrowUp / Backspace |
| Toggle hints         | Escape / I                      |
| Toggle auto mode     | A                               |
| Next escalation step | D                               |

---

# Visible Controls

The player must display control buttons.

Buttons should remain **visually discreet**.

Examples:

```text id="player_buttons"
Next
Previous
Toggle hints
Toggle auto
Step
```

Buttons must match the keyboard actions.

---

# Error Handling

If audio playback fails:

Display:

```text id="error_message"
Schrouunntch
```

The host can skip to the next panel.

---

# Gameplay Requirements

The player must guarantee:

* deterministic transitions
* stable timers
* consistent round behavior
* manual host override at all times

The host must always be able to:

* skip forward
* go back
* disable automation
* recover from errors
