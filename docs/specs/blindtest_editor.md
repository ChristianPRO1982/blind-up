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

CSS:

```
.song-card.active
```

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

Rules:

```
if field empty → use source metadata
if field filled → use override
```

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
