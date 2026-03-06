# BlindUp — Library Scan Specification

This document defines the **music library scan feature**.

The scan imports audio files from a user-defined root folder into the SQLite database.

It is responsible for:

- recursively scanning the music folder
- detecting supported audio files
- extracting metadata
- generating file hashes
- inserting new songs
- removing missing songs from the library table
- preserving broken blindtest slots when referenced songs disappear

The scan does **not** manage blindtests.

The feature includes:

* backend scan execution
* Library scan panel UI
* scan summary display

---

# Objective

The goal of the library scan is to keep the `songs` table synchronized with the real music library on disk.

The scan must be safe, deterministic, and simple.

---

# Root Folder

The music library root folder is configured by the application host.

Example:

```text
/users/moi/music/
```

The scan starts from this root folder and explores all subfolders recursively.

In the UI, the path is displayed in the **Library scan panel** as a fixed local path.

The scan always starts from that configured path.

---

# Library Scan Panel

The Library scan panel is opened from the **Home panel**.

Its layout is intentionally simple:

```text
Library Scan Panel
 ├── Root path input
 ├── Start / Stop scan button
 └── Scan info panel
```

## Required controls

The panel must include:

* a visible field showing the configured `root_path`
* a `Start scan` action
* a `Stop scan` action while a scan is running

The same primary control may change label between:

* `Start scan`
* `Stop scan`

## Scan info panel

The panel must display scan information after completion.

At minimum it shows:

* number of new songs
* number of removed songs
* list of blindtests impacted by removed songs

The panel remains visible after the scan finishes.

The host stays on the Library scan panel after completion.

---

# Supported Audio Formats

The scan must support common consumer audio formats, including Apple formats.

Minimum supported extensions:

* `.mp3`
* `.flac`
* `.m4a`
* `.aac`
* `.mp4`

Implementation may support more formats later, but these are the expected formats for MVP.

Extension matching must be case-insensitive.

Examples:

* `track01.MP3`
* `song.flac`
* `album_track.m4a`

---

# Recursive Scan Rules

The scan must:

* walk the full directory tree recursively
* ignore non-audio files
* ignore directories that do not contain supported files
* process files in a deterministic order

Recommended deterministic rule:

* sort directories by path
* sort files by path

This avoids unstable scan results.

---

# Song Identification

Songs are identified by a **file hash**.

The file hash must be stable for the same file content.

Recommended algorithm:

```text
SHA-256
```

The hash is used to:

* detect the same song after rename or move
* avoid duplicate inserts for the same file content

---

# Metadata Extraction

For each supported audio file, the scan extracts:

* duration
* title
* artist
* album
* year
* genre
* embedded cover image if present

These values populate the `songs` table.

If metadata is missing, the corresponding fields remain empty.

---

# Cover Handling

If the file contains an embedded cover image:

* extract it
* save it to an application-managed covers folder
* expose it through a backend-served HTTP path
* store that public path in `songs.cover_path`

If no cover exists:

* `cover_path` remains null or empty

The scan must not modify the original audio file.

Example public cover path:

```text
/media/covers/{file_hash}.jpg
```

The scan must not store a raw local filesystem path as a UI-facing image source.

---

# Database Synchronization Rules

## New file found

If a scanned file hash does not exist in the database:

* create a new row in `songs`

## Existing file found by hash

If the hash already exists:

* update `file_path`
* update `duration_sec`
* update timestamps
* update extracted metadata only if the application policy allows it

For MVP, the scan should refresh extracted metadata from the file.

## Missing file

If a song exists in the database but its file is no longer present anywhere in the scan result:

* remove the row from `songs`
* detect whether this song is referenced by one or more `blindtest_songs`
* for each referenced blindtest slot:
  * keep the slot
  * set `song_id = null`
  * set `slot_status = missing`
  * preserve the last known metadata snapshot in `source_*`

The scan must **not** delete or silently collapse blindtest slots.

This allows the editor to show a visible broken slot that the host can repair later.

If a file was only renamed or moved without content change:

* the file hash remains the same
* the song row is updated normally
* no blindtest slot becomes broken

---

# Manual Metadata Edits

The application allows manual metadata edits later.

However, the scan itself only manages library synchronization.

For MVP, the scan is allowed to overwrite extracted library metadata with the latest file metadata.

Blindtest overrides remain independent and are never affected by the scan.

---

# Error Handling

If a file cannot be parsed:

* skip the file
* continue the scan
* log the error

A single broken file must not stop the full scan.

Examples of scan errors:

* unreadable file
* unsupported encoding
* corrupt metadata
* invalid audio container

If the root path is invalid:

* the scan must fail clearly
* the Library scan panel stays visible
* the host can stop the running scan request if needed
* the host can correct the path and retry

If the host decides the scan was started with the wrong path and is taking too long:

* the host can request scan cancellation from the UI
* the application stops the current scan as soon as practical

---

# Expected Scan Flow

```text
1. Read configured root folder
2. Recursively collect supported audio files
3. For each file:
   - compute hash
   - extract metadata
   - extract cover
   - upsert database row
4. Detect database songs no longer present
5. if missing song is referenced:
   - convert blindtest slots to missing slots
   - delete the song row
6. if missing song is not referenced:
   - delete the song row
7. return scan summary
```

---

# Suggested Scan Summary

After each scan, return a summary object containing:

* scanned file count
* added song count
* updated song count
* removed song count
* broken slot count
* impacted blindtests list
* skipped file count
* error count

Example:

```json
{
  "root_path": "/users/moi/music/",
  "scanned_files": 248,
  "added": 12,
  "updated": 231,
  "removed": 5,
  "broken_slots": 2,
  "impacted_blindtests": [
    {
      "id": 3,
      "title": "Friday night"
    },
    {
      "id": 7,
      "title": "80s set"
    }
  ],
  "skipped": 2,
  "errors": 2
}
```

---

# API Expectations

The backend should expose a cancellable scan lifecycle for the Library scan panel.

Example:

```text
POST /api/library/scan/start
POST /api/library/scan/stop
GET /api/library/scan/status
```

The backend should also expose read-only media routes for extracted covers.

Example:

```text
GET /media/covers/{filename}
```

## `POST /api/library/scan/start`

Starts a scan from the path entered by the host.

Possible request body:

```json
{
  "root_path": "/users/moi/music/"
}
```

Possible immediate response:

```json
{
  "status": "running"
}
```

## `POST /api/library/scan/stop`

Requests cancellation of the current scan.

Possible response:

```json
{
  "status": "stopping"
}
```

## `GET /api/library/scan/status`

Returns the current scan state and the latest completed summary when available.

Possible response:

```json
{
  "status": "idle",
  "summary": {
    "root_path": "/users/moi/music/",
    "scanned_files": 248,
    "added": 12,
    "updated": 231,
    "removed": 5,
    "broken_slots": 2,
    "impacted_blindtests": [
      {
        "id": 3,
        "title": "Friday night"
      }
    ],
    "skipped": 2,
    "errors": 2
  }
}
```

---

# Performance Expectations

The scan is local and may process many files.

Expected behavior:

* acceptable performance on a personal music library
* only one scan runs at a time
* the scan must be cancellable from the host UI
* no heavy distributed job system is required for MVP

A lightweight in-process background task is acceptable for MVP.

---

# Logging

The scan should produce usable logs.

Minimum log events:

* scan started
* root path used
* file processed
* file skipped
* metadata extraction failed
* song inserted
* song updated
* song removed
* blindtest slot marked missing
* scan finished

Logs should be readable in development.

---

# Security Rules

The scan must:

* only access the configured local root folder
* never execute external files
* never modify source audio files
* never trust metadata blindly for file operations

Cover extraction output must be written only inside the application storage area.

---

# Non-Goals

The scan does not:

* build blindtests
* edit blindtest overrides
* normalize genres
* deduplicate user content by business logic
* reorganize folders
* rename files

Duplicate files in different folders remain the user's responsibility.

---

# Implementation Notes

Recommended Python responsibilities:

* filesystem traversal
* hash computation
* metadata extraction
* SQLite persistence

Recommended separation:

```text
services/library_scan_service.py
services/audio_metadata_service.py
repositories/song_repository.py
```

This keeps the implementation modular.

---

# Acceptance Criteria

The feature is correct if:

* the host can open the Library scan panel from Home
* the host can enter the root path directly in the panel
* the host can start a scan from that path
* the host can stop a running scan
* the scan processes the full root folder recursively
* supported audio files are imported into `songs`
* file hashes are generated and stored
* tags are extracted and stored
* missing files are removed from `songs`
* broken files do not stop the scan
* the summary includes impacted blindtests
* the panel stays on the scan screen after completion
