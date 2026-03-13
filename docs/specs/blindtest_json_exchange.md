# BlindUp — Blindtest JSON Exchange

## Objective

Define a **portable blindtest exchange format** and the related import/export workflows.

This feature has five goals:

* save a blindtest as JSON
* create a new blindtest from a JSON file
* import only song slots from a JSON file into an existing blindtest in the editor
* export the current song list as `song_list.tsv`
* expose a stable JSON contract that can be consumed by a human or an LLM

The intent is to let a host save and share blindtests locally, and to let an LLM generate valid blindtests when given:

* the JSON contract
* the `song_list.tsv` catalog export
* an appropriate prompt

---

# 1 Scope

This feature is **local-first**.

No cloud sync is required.

Files are imported from and exported to the host filesystem.

The feature does not replace the SQLite persistence model.
It adds a portable format on top of it.

---

# 2 Artifacts

The system must support three file artifacts.

## 2.1 Blindtest JSON

A blindtest saved by the application.

Suggested extension:

```text
.json
```

Suggested filename:

```text
my-blindtest.json
```

This file contains:

* blindtest title
* global gameplay parameters
* song slot definitions
* metadata overrides
* `La la la...` segment configuration

This is the main import/export payload.

## 2.2 JSON Contract

A machine-readable contract describing the blindtest JSON format.

Suggested filename:

```text
blindup_contrat.json
```

This file is not a blindtest instance.
It describes the expected structure, required fields, enums, nullable fields, and semantic rules.

The contract must be stable enough to be used:

* by developers
* by validation tools
* by an LLM generating blindtest JSON

## 2.3 Song List TSV

A flat export of the songs currently available in memory in the application.

Required filename:

```text
song_list.tsv
```

Required columns, in order:

```text
title	artist	album	year	genre
```

Rules:

* one song per line
* UTF-8 text output
* header row required
* empty values allowed

This file is intended as lightweight input for prompt-based blindtest generation.

---

# 3 Blindtest JSON Semantics

The blindtest JSON must represent the same logical object as an in-app blindtest.

It must include:

* a format version
* a blindtest object
* global settings
* song slots

Suggested top-level shape:

```json
{
  "format": "blindup_blindtest",
  "version": 1,
  "blindtest": {
    "title": "Friday night",
    "background_image": "/media/backgrounds/friday.jpg",
    "game_mode": "blindup",
    "pre_play_delay_sec": 1.5,
    "auto_enabled_default": true,
    "hints_enabled_default": false,
    "answer_timer_enabled": true,
    "answer_duration_sec": 12,
    "round3_step_durations": "0.5,1,1.5,2,3,4,5",
    "round3_step_gap_sec": 3,
    "round3_progression_mode": "fixed_start",
    "songs": [
      {
        "order_index": 0,
        "slot_status": "ok",
        "start_sec": 45,
        "duration_sec": 3.5,
        "source_title": "Song A",
        "source_artist": "Artist A",
        "source_album": "Album A",
        "source_year": 2004,
        "source_genre": "Pop",
        "source_background": "/media/backgrounds/song-a.jpg",
        "override_title": "",
        "override_artist": "",
        "override_album": "",
        "override_year": null,
        "override_genre": "",
        "override_background": "",
        "custom_hint": ""
      }
    ]
  }
}
```

Notes:

* exported JSON must not depend on internal database IDs to remain portable
* `song_id` is optional in exported JSON and should not be required for import
* `source_*` fields act as a portable metadata snapshot
* image fields must remain browser-loadable HTTP paths or app-relative media paths

---

# 4 Save Blindtest As JSON

The host must be able to save a blindtest as JSON from the editor.

Expected behavior:

* export the currently loaded blindtest
* include global settings
* include all song slots in current order
* include broken slots and pending slots if they exist
* write a JSON file that matches the declared contract version

The save action does not replace the normal database save action.

Both forms of persistence may coexist:

* local DB save
* portable JSON export

---

# 5 Create New Blindtest From JSON

The Home panel must allow importing a JSON file as a **new blindtest**.

Expected behavior:

* the host selects a JSON file
* the application validates it against the blindtest JSON contract
* if valid, a new blindtest is created in local storage
* global settings from the JSON are applied
* song slots from the JSON are imported
* the new blindtest appears in the Home list
* the host may then open it in the editor

Import must never overwrite an existing blindtest automatically.

If the imported JSON references songs that do not currently exist in the library:

* the slots are still imported
* `slot_status` should become `missing` if needed
* `source_*` metadata must remain visible

---

# 6 Import Songs Into Current Blindtest From JSON

The editor must allow importing songs from a blindtest JSON file into the currently opened blindtest.

This import is intentionally partial.

Expected behavior:

* the host selects a JSON file
* the application validates it against the blindtest JSON contract
* only song slots are imported
* current blindtest global settings remain unchanged
* imported song slots are added to the current song list

Must not be imported from the file:

* title
* game mode
* default toggles
* answer timer configuration
* round 3 configuration
* blindtest background image

Imported songs should preserve:

* order from the source JSON
* `La la la...` segment settings
* metadata overrides
* custom hints
* `source_*` snapshot fields

---

# 7 Song List TSV Export

The application must expose an export of the songs currently loaded in memory as `song_list.tsv`.

The in-memory source may be the current library payload already loaded by the frontend.

Required columns:

* `title`
* `artist`
* `album`
* `year`
* `genre`

This export must not include gameplay settings or blindtest-specific overrides.

The purpose is catalog description, not blindtest persistence.

---

# 8 Validation Rules

All JSON imports must validate:

* top-level `format`
* top-level `version`
* expected object shape
* allowed enums
* required field types

Validation failures must be explicit and local-friendly.

Examples:

* unsupported contract version
* missing `blindtest.songs`
* invalid `game_mode`
* invalid `round3_progression_mode`
* non-numeric `start_sec`

The application should refuse import if the file is structurally invalid.

---

# 9 API / Frontend Responsibilities

Suggested responsibilities:

## Backend

* provide the canonical JSON export payload
* provide the canonical contract payload
* validate imported JSON
* create a blindtest from imported JSON

## Frontend

* trigger file selection
* upload/import the selected JSON
* download exported JSON
* download `song_list.tsv`
* expose the import entry points in Home and Editor

Suggested endpoints:

```text
GET  /api/blindtest/{id}/export-json
GET  /api/blindtest-contract
POST /api/blindtests/import-json
POST /api/blindtest/{id}/import-songs-json
GET  /api/songs/export-tsv
```

Endpoint names may differ, but the separation of concerns should remain clear.

---

# 10 Correctness

This feature is correct if:

* a blindtest can be exported as JSON
* a valid JSON file can create a new blindtest from Home
* a valid JSON file can add songs into the current blindtest from Editor
* editor song import does not overwrite current global settings
* `song_list.tsv` is exported with the required columns
* a stable machine-readable contract exists for blindtest JSON
* an LLM can rely on the contract plus `song_list.tsv` to generate a structurally valid blindtest JSON
