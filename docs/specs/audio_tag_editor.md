# BlindUp — Audio Tag Editor Panel

## Objective

Implement the **Audio Tag Editor panel**.

This panel allows the host to:

* browse the music library folders
* list only the songs contained in the selected folder
* inspect audio metadata tags
* modify editable tags
* save those changes back to the audio files
* return to the previous navigation level using `Back`

This panel is a library maintenance tool.
It is separate from blindtest editing.

For MVP, tag editing support is required for:

* MP3
* FLAC

Other supported library formats may be handled as long as the tag-writing backend supports them.

---

# Layout

```
Audio Tag Editor Layout
 ├── Header
 └── Main split view
     ├── Folder browser (left, 25%)
     └── Tag table (right, 75%)
```

---

# 1 Header

Top bar.

Elements:

* panel title
* `Save changes` button
* `Back` button

Example:

```
[ Audio Tag Editor ]      [Save changes] [Back]
```

### Back Button Behavior

The `Back` button returns to the **Home panel**.

Expected behavior:

* it does not save automatically
* it leaves the audio tag editor
* it returns to the previous navigation level, which is the Home panel

For MVP, no intermediate screen exists between Home and the Audio Tag Editor panel.

---

# 2 Folder Browser

The left area is a filesystem browser focused on the configured music library.

Width target:

* about one quarter of the available panel width

The browser must display:

* folders
* subfolders

It must not display:

* audio files as a tree in the browser column
* folders outside the configured music library root

### Navigation Rules

The host can:

* open a folder
* expand or reveal subfolders
* select a folder as the active folder

When a folder is selected:

* the tag table shows only songs whose files are directly inside that folder
* songs from nested subfolders are excluded from the table

Example:

```text
/music-library
├── Rock
│   ├── song-a.mp3
│   └── Live
│       └── song-b.mp3
```

If `Rock` is selected:

* `song-a.mp3` is shown
* `song-b.mp3` is not shown

---

# 3 Tag Table

The right area displays the songs for the selected folder.

Width target:

* about three quarters of the available panel width

The table columns are:

* file name
* title
* artist
* album
* year
* genre

### File Name Column

The file name column must show:

* the base file name only
* no parent path

Examples:

* `track01.mp3`
* `Artist - Song.flac`

This column is read-only.

### Editable Columns

The following columns are editable:

* title
* artist
* album
* year
* genre

The panel should support inline editing directly in the table.

For MVP, all edited rows may be saved together using the single panel action.

### Empty State

If the selected folder contains no supported audio files directly inside it:

* keep the folder selected
* show an empty table state
* do not automatically fall back to another folder

---

# 4 Save Behavior

Metadata changes are not persisted immediately.

The panel exposes a single explicit action:

* `Save changes`

When the host clicks the button:

* validate edited values
* write the updated tags into the corresponding audio files
* refresh the matching `songs` rows in the database
* keep the current folder selected
* refresh the table values from the saved state

If no row has changed:

* the save action may be disabled
* or it may do nothing visibly

### Validation Rules

Minimum validation:

* `year` must be empty or a valid integer year
* text fields may be empty
* file name must remain immutable

---

# 5 Database Synchronization

The application database remains a mirror of the current file tags.

After a successful save:

* the corresponding `songs.title` is updated
* the corresponding `songs.artist` is updated
* the corresponding `songs.album` is updated
* the corresponding `songs.year` is updated
* the corresponding `songs.genre` is updated
* `songs.updated_at` is refreshed

The panel must not require a full library rescan after each edit.

---

# 6 Scope Rules

This panel edits the source library metadata.

It does not:

* edit blindtest-specific overrides
* edit `La la la...` regions
* reorder songs
* change gameplay settings

Those behaviors remain in the Blindtest Editor panel.

---

# 7 Suggested API

Suggested endpoints:

```text
GET  /api/library/folders
GET  /api/library/folder-songs?path=...
POST /api/library/song-tags
```

Expected behavior:

## `GET /api/library/folders`

Returns the folder tree rooted at the configured music library path.

The response should include enough information to:

* render parent folders
* render subfolders
* identify the selected folder

## `GET /api/library/folder-songs?path=...`

Returns only songs whose files are directly inside the target folder.

Each row should include at minimum:

* `song_id`
* `file_name`
* `title`
* `artist`
* `album`
* `year`
* `genre`

## `POST /api/library/song-tags`

Persists tag updates to one or more songs.

Each update item should include:

* `song_id`
* editable tag fields

Expected behavior:

* reject updates outside the configured music library
* update file tags first
* update the database row after a successful file write
* return refreshed song rows

---

# 8 Correctness

The Audio Tag Editor panel is correct if:

* the host can open it from Home
* the layout uses a 25% / 75% split
* the left side displays folders and subfolders
* selecting a folder shows only songs directly inside that folder
* the table displays file name, title, artist, album, year, and genre
* only non-file-name columns are editable
* changes are persisted only through the explicit save button
* `Back` returns to Home
