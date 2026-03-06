# BlindUp — Blindtest Editor Panel

## Objective

Implement the **Blindtest Editor Panel**.

This panel allows a user to:

* configure a blindtest
* add songs from the library
* override metadata
* select the teaser region using a waveform editor
* reorder songs
* configure global gameplay parameters

Frontend uses:

* **HTML / CSS**
* **Vanilla JavaScript**
* **WaveSurfer.js v7**
* **Regions plugin** for teaser selection.

WaveSurfer renders an interactive waveform and allows selection of audio regions that represent the teaser segment. ([wavesurfer.xyz][1])

---

# Layout

```
Editor Layout
 ├── Header
 ├── Blindtest Settings
 ├── Song List
 ├── Song Editor Panel
 └── Library Panel (right sidebar)
```

---

# 1 Header

Top bar.

Elements:

* Blindtest title input
* Save button
* Launch button
* Back button

Example:

```
[ Title input ]        [Save] [Launch] [Back]
```

---

# 2 Blindtest Settings

Global configuration of the blindtest.

Fields:

```
Game Mode
- Blind Test
- BlindUp

Pre-play delay (seconds)

Auto enabled by default (toggle)

Indices enabled by default (toggle)

Answer timer enabled (toggle)

Answer duration seconds
```

### Round 3 settings

```
Step durations preset
Example: 0.5,1,1.5,2,3,4,5

Step gap seconds

Progression mode
- fixed_start
- continuous
```

---

# 3 Song List

List of songs included in the blindtest.

Each song is displayed as a **song card**.

```
Song Card

[cover]  Title — Artist
Start: 00:45
Duration: 3.5s

[Edit] [Remove]
```

### Features

* drag & drop reorder
* click to select
* active card highlighted
* broken slots remain visible and editable

CSS:

```
.song-card.active
.song-card.missing
```

### Broken Slot Presentation

If a slot no longer points to a valid library song:

* the card remains in the list
* the card is highlighted in orange
* a visible roadwork indicator is shown, for example `🚧`
* the card displays a short status such as `Missing audio`
* the card still shows the last known song metadata from `source_*`

The host must immediately understand that the blindtest structure is intact but that repair is required.

### Blindtest Open Validation

When a blindtest is opened in the editor, the application must perform a lightweight integrity check.

This check does **not** rescan the whole music library.

It only verifies:

* whether `blindtest_songs.song_id` still points to an existing `songs` row
* whether the referenced `songs.file_path` still exists on disk

If a reference is broken:

* the slot remains in the blindtest
* `slot_status` becomes `missing`
* the editor displays the broken slot presentation immediately

The goal is to surface broken blindtest entries as soon as the host opens the blindtest, even before running a library scan.

### Suggested API

The backend may expose a lightweight validation endpoint for this purpose.

Example:

```text
POST /api/blindtest/{id}/validate-links
```

Expected behavior:

* validate only the slots belonging to the target blindtest
* do not compute file hashes
* do not walk the full music library
* update broken slots in place if needed
* return a short summary of detected missing slots

---

# 4 Song Editor Panel

Displays settings for the **selected song**.

## Metadata fields

Single form.

Metadata from the library appear as **placeholder values**.

Fields:

```
Title
Artist
Album
Year
Genre
Cover
Custom hint
```

Image-related fields must use backend-served URLs or app-relative HTTP paths.

Rules:

```
if field empty → use source metadata
if field filled → use override
```

For image fields:

* placeholders may show backend-served paths
* overrides must remain directly loadable by the browser
* raw local filesystem paths must not be used as UI image sources

If the slot is broken:

* placeholders use `source_*` values stored in the blindtest slot
* the editor remains fully accessible
* the host may keep, edit, replace, or remove the slot

### Broken Slot Repair

A broken slot can be repaired by replacing it with a library song.

Expected behaviors:

* click broken slot, then click library song → replace target slot
* drag library song onto broken slot → replace target slot
* after replacement:
  * `song_id` points to the new song
  * `slot_status` returns to `ok`
  * `source_*` snapshot is refreshed from the new library song

---

# 5 Waveform Teaser Editor

Audio teaser selection using **WaveSurfer.js**.

WaveSurfer is used to render the waveform and handle audio playback. ([wavesurfer.xyz][1])

The **Regions plugin** defines the teaser selection area. ([wavesurfer.xyz][2])

Example initialization:

```javascript
import WaveSurfer from 'wavesurfer.js'
import Regions from 'wavesurfer.js/dist/plugins/regions.esm.js'

const wavesurfer = WaveSurfer.create({
  container: '#waveform',
  waveColor: '#999',
  progressColor: '#333',
  url: audioUrl
})

const regions = wavesurfer.registerPlugin(Regions.create())
```

---

## Controls

```
Play/Pause
Zoom -
Zoom +
Zoom reset
Mark
Reset selection
```

Display:

```
Current time
Start
End
Duration
```

---

# 6 Mark Button Logic

Single button used to set **start and end markers**.

### Case 1

No markers defined

```
Mark → set start
```

### Case 2

Only start defined

```
if current_time < start
    set start
else
    set end
```

### Case 3

Start and end defined

```
if current_time < start
    set start

else if current_time > end
    set end

else
    relative = (current_time - start) / (end - start)

    if relative <= 0.25
        set start
    else
        set end
```

---

# 7 Region Behavior

The region represents the teaser.

```
start_sec = region.start
duration_sec = region.end - region.start
```

Region properties:

```
draggable
resizable
```

---

# 8 Library Panel

Right sidebar containing the **music library**.

The panel stays open.

```
[ Search field ]

[cover] Title — Artist
Album • Year
Duration
```

---

## Interactions

### Drag and drop

Drag library song → drop on song card

```
song_card.song_id = library_song_id
```

---

### Click selection

Click song card → becomes target.

Click library song → replaces target.

---

### No target

Click library song

```
append new song slot
```

---

# 9 Song Slots

Slots are created automatically.

Example:

```
Song 1
Song 2
Song 3
```

No predefined slots.

---

# 10 Song Removal

Each song card contains:

```
Remove
```

Behavior:

```
delete slot
reindex order
```

---

# Expected Behaviour Summary

```
Click library song without target → append

Click library song with target → replace

Drag library song to slot → replace

Drag song cards → reorder

Missing slot stays visible until manually repaired or removed
```

---

# Future Extensions (not required now)

* multi-select add
* batch randomization
* keyboard shortcuts
* waveform minimap
* auto preview of teaser region

---

[1]: https://wavesurfer.xyz/docs/?utm_source=chatgpt.com "API reference"
[2]: https://wavesurfer.xyz/plugins/regions?utm_source=chatgpt.com "Regions plugin"
