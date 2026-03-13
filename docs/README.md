# BlindUp — Documentation

This directory contains the documentation for the **BlindUp** project.

BlindUp is a local web application used to run music quiz sessions based on a blind test format inspired by *Time’s Up*.

The application allows a host to:

* scan a local music library
* create blind tests from the library
* configure `La la la...` segments for each song
* run the game in either **Blind Test mode** or **BlindUp mode**

BlindUp is designed as a **single-host local tool**.
There are no players connected to the application.

---

# Documentation Structure

This directory is split into two parts:

```
docs/
├── README.md
├── product_spec.md
├── gameplay_rules.md
├── architecture_overview.md
└── specs/
```

---

# General Documentation

These documents describe the **global behavior of the application**.

### `product_spec.md`

High-level description of the application:

* goals
* main features
* user workflow
* UI panels

---

### `gameplay_rules.md`

Detailed explanation of the **BlindUp game rules**:

* the three rounds
* `La la la...` behaviour
* hints
* timers
* keyboard shortcuts

---

### `architecture_overview.md`

Overview of the technical architecture:

* FastAPI backend
* SQLite database
* frontend structure
* audio handling
* main services

---

# Implementation Specifications

```
docs/specs/
```

This folder contains **technical specifications for individual components**.

Each file describes **one isolated feature** that can be implemented independently.

Example files:

* `blindtest_editor.md`
* `blindtest_json_exchange.md`
* `blindtest_player.md`
* `home_panel.md`
* `library_scan.md`
* `song_waveform_editor.md`
* `db_schema.md`

The goal is that a developer (or Codex) can implement a feature by reading **only one spec file**.

---

# Development Philosophy

BlindUp follows a few simple principles:

* local-first application
* minimal dependencies
* simple UI
* deterministic game behaviour
* host-oriented controls

The project prioritizes **clarity and reliability** over complexity.

---

# How to Use These Docs

When implementing a feature:

1. Read the relevant file in `docs/specs/`
2. Follow the behavior described in that spec
3. Do not introduce additional behaviors unless documented

This helps keep the application consistent and predictable.
