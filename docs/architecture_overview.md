# BlindUp — Architecture Overview

This document describes the **technical architecture** of the BlindUp application.

BlindUp is designed as a **local-first web application** optimized for reliability and simplicity.

The application is composed of:

* a **Python FastAPI backend**
* a **SQLite database**
* a **vanilla JavaScript frontend**
* local audio file processing

---

# High Level Architecture

```text
Browser (Frontend)
        │
        │ HTTP / JSON
        ▼
FastAPI Backend
        │
        │ SQL
        ▼
SQLite Database
        │
        │ filesystem access
        ▼
Local Music Library
```

The browser interacts only with the FastAPI server.

The backend manages:

* music library scanning
* blindtest persistence
* gameplay configuration
* audio file access

---

# Backend

The backend uses **FastAPI**.

Responsibilities:

* REST API
* database access
* music library scanning
* metadata extraction
* audio file serving

The backend does **not** process audio transformations such as reverse playback.

Audio transformations are handled in the frontend.

---

# Frontend

The frontend is a **single page application** built with:

* HTML
* CSS
* Vanilla JavaScript

There is **no framework** such as React or Vue.

The frontend handles:

* game rendering
* user interactions
* waveform editing
* audio playback
* game state transitions

---

# Audio Handling

Audio files remain in the **user music folder**.

Example:

```text
/users/moi/music/
```

The application never moves or modifies these files.

The backend reads metadata and stores it in the database.

The frontend loads audio files directly through the backend.

Example:

```text
/api/audio/{song_id}
```

---

# Image Handling

The browser must load images only through **HTTP URLs served by the backend**.

This applies to:

* extracted song covers
* blindtest background images
* metadata override covers used in gameplay

The frontend must **not** use raw local filesystem paths as image sources.

Instead, the backend exposes public local routes.

Examples:

```text
/media/covers/{file_hash}.jpg
/media/backgrounds/{filename}
```

The database may store these public app-relative paths, but never paths that are only meaningful on the host filesystem.

---

# Waveform Editing

Waveform rendering and teaser editing are handled using:

* **WaveSurfer.js v7**
* **Regions plugin**

WaveSurfer provides:

* waveform visualization
* playback controls
* region editing

Regions represent the teaser segment.

Example:

```text
start_sec
duration_sec
```

---

# Reverse Playback

Reverse playback used in **Round 2** is performed in the frontend.

Steps:

1. Load the audio buffer
2. Extract the teaser segment
3. Reverse the audio buffer
4. Play the reversed segment

This avoids creating additional files on disk.

---

# Database

The application uses **SQLite**.

SQLite is chosen because:

* the application is local
* concurrency requirements are minimal
* it simplifies deployment

The database stores:

* songs
* blindtests
* blindtest songs
* gameplay settings

---

# File Hash Identification

Songs are identified using a **file hash**.

The hash allows the application to:

* detect renamed files
* avoid duplicates
* maintain stable references

Hashes are calculated during library scanning.

---

# Library Scanning

The backend scans the configured music folder.

The scan process:

1. recursively explore the directory
2. detect supported audio files
3. extract metadata tags
4. compute file hash
5. update the database

The scan can:

* add new songs
* remove missing songs

It does **not modify existing metadata automatically**.

---

# Application Panels

The frontend is composed of several panels:

* Home panel
* Library scan panel
* Blindtest editor panel
* Game player panel

Panels are displayed dynamically in the SPA.

---

# Game Engine

The game engine runs entirely in the **frontend**.

Responsibilities:

* panel transitions
* timers
* teaser playback
* hint timing
* keyboard shortcuts

The backend does not manage gameplay state.

---

# Static Assets

Static assets include:

* CSS styles
* frontend JavaScript
* background images
* icons

These assets are served by the backend.

Application-managed media such as extracted covers must also be served by the backend through dedicated HTTP routes.

---

# Error Handling

If an audio file cannot be played:

* the player panel displays:

```text
Schrouunntch
```

The host can manually skip the song.

---

# Design Principles

BlindUp follows a few core principles:

### Local First

The application works entirely on a local machine.

No external services are required.

---

### Minimal Dependencies

The stack intentionally avoids heavy frameworks.

This simplifies maintenance and improves reliability.

---

### Host Control

The host must always be able to:

* skip a panel
* override automatic behavior
* recover from errors quickly

---

# Deployment Model

BlindUp is intended to run locally.

Typical usage:

```text
FastAPI server running on localhost
Browser opened in full screen
Computer connected to a projector
```

The host controls the game from the same device.

---
