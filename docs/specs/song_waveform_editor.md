# BlindUp — Song Waveform Editor Specification

This document defines the **waveform editor component** used in the blindtest editor.

The component allows the user to:

* visualize the waveform of a song
* play and pause audio
* zoom into the waveform
* define a `La la la...` region
* adjust the region visually
* compute `start_sec` and `duration_sec`

The editor is implemented in the **frontend**.

---

# Technology

The waveform editor is built using:

* **WaveSurfer.js v7**
* **Regions plugin**

WaveSurfer provides:

* waveform rendering
* playback control
* time tracking

Regions allow visual selection of the `La la la...` segment.

---

# Component Layout

```text id="waveform_layout"
Waveform editor

[Waveform view]

Play / Pause
Zoom -
Zoom +
Zoom Reset
Mark
Reset Selection

Current Time
Start
End
Duration
```

---

# Waveform View

The waveform view displays the full audio waveform.

Requirements:

* responsive width
* scrollable when zoomed
* draggable region
* resizable region

The waveform container example:

```html id="waveform_container"
<div id="waveform"></div>
```

---

# WaveSurfer Initialization

Example initialization:

```javascript id="wavesurfer_init"
import WaveSurfer from 'wavesurfer.js'
import Regions from 'wavesurfer.js/dist/plugins/regions.esm.js'

const wavesurfer = WaveSurfer.create({
  container: '#waveform',
  waveColor: '#999',
  progressColor: '#333',
  height: 120,
})

const regions = wavesurfer.registerPlugin(Regions.create())
```

Audio is loaded dynamically.

Example:

```javascript id="wavesurfer_load"
wavesurfer.load(audioUrl)
```

---

# Region Representation

The `La la la...` segment is represented by a **single region**.

Region parameters:

```text id="region_fields"
start
end
```

Derived values:

```text id="region_values"
start_sec = region.start
duration_sec = region.end - region.start
```

---

# Region Behavior

The region must support:

* drag
* resize

Example region creation:

```javascript id="region_create"
regions.addRegion({
  start: 10,
  end: 15,
  drag: true,
  resize: true
})
```

When the region changes:

* update start_sec
* update duration_sec
* refresh UI labels

---

# Mark Button Logic

The editor uses a **single button** called `Mark`.

This button sets `start` or `end` depending on the current playback position.

---

## Case 1 — No region defined

```text id="mark_case1"
Mark → set start
```

A temporary region is created.

---

## Case 2 — Only start defined

```text id="mark_case2"
if current_time < start
    set start
else
    set end
```

---

## Case 3 — Start and End defined

If playback position is:

### Before region

```text id="mark_before"
set start
```

### After region

```text id="mark_after"
set end
```

### Inside region

Compute relative position:

```text id="mark_relative"
relative = (current_time - start) / (end - start)
```

Decision:

```text id="mark_quarter_logic"
if relative <= 0.25
    set start
else
    set end
```

---

# Reset Selection

Reset Selection removes the region.

Behavior:

```text id="reset_behavior"
delete region
start_sec = null
duration_sec = null
```

---

# Playback Controls

Controls include:

* Play / Pause toggle
* Seek via waveform click

Example:

```javascript id="play_pause_example"
wavesurfer.playPause()
```

---

# Zoom Controls

The waveform editor must support zooming.

Zoom levels allow more precise selection of `La la la...` segments.

Controls:

```text id="zoom_controls"
Zoom In
Zoom Out
Zoom Reset
```

Example:

```javascript id="zoom_example"
wavesurfer.zoom(100)
```

Zoom Reset returns to default zoom.

---

# Time Display

The editor displays:

```text id="time_display"
Current time
Start
End
Duration
```

Example display:

```text id="display_example"
Current: 01:12.5
Start: 01:10.0
End: 01:13.5
Duration: 3.5s
```

---

# Region Constraints

Region must obey:

* `start >= 0`
* `end > start`
* `end <= audio_duration`

If invalid values occur, the editor must correct them.

---

# UI Feedback

The editor should indicate what the **Mark** button will do.

Example dynamic label:

```text id="mark_label_start"
Mark → Start
```

```text id="mark_label_end"
Mark → End
```

This improves usability.

---

# Audio Loading

Audio files are loaded from the backend.

Example endpoint:

```text id="audio_endpoint"
/api/audio/{song_id}
```

The editor must support switching songs without reloading the page.

---

# Error Handling

If audio cannot be loaded:

* display a simple error message
* disable waveform controls

Example message:

```text id="audio_error"
Audio unavailable
```

---

# Performance Expectations

The waveform editor should:

* load quickly
* handle long tracks
* remain responsive during zoom
* avoid memory leaks when switching songs

WaveSurfer instances should be destroyed when the editor is reloaded.

Example:

```javascript id="wavesurfer_destroy"
wavesurfer.destroy()
```

---

# Acceptance Criteria

The waveform editor is correct if:

* the waveform displays the audio file
* the user can zoom in/out
* the user can play/pause audio
* the Mark button correctly sets start/end
* a region visually represents the `La la la...`
* start_sec and duration_sec update correctly
* reset removes the region
* switching songs reloads the waveform safely
