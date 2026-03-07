# BlindUp — UI Graphic Guidelines V1

## 1. Visual spirit

BlindUp uses a **night / neon / arcade-show** aesthetic.

The interface must feel:

- festive
- musical
- modern
- readable
- energetic without becoming aggressive

The UI should evoke:

- a live music quiz show
- a fun host-driven party game
- a stylish night-time atmosphere
- friendly tension and playful competition

The design must stay **clean and structured**.
The neon effect is a highlight, not a visual overload.

---

## 2. Global direction

### Background

The global background must be based on a **deep night tone**.

Guidelines:

- use a very dark base
- avoid pure black everywhere
- prefer deep blue / midnight / dark indigo families
- the background must make neon accents glow naturally
- subtle gradients or soft light halos are allowed
- background decoration must stay discreet and never reduce readability

The background should support the impression of a modern music stage or electro night ambiance.

---

### Main text

Text must remain highly readable at all times.

Guidelines:

- default text should be light on dark background
- prefer soft white or very light cool tones instead of harsh pure white everywhere
- headings can be brighter and more expressive
- important labels may use accent colors sparingly
- long text blocks must remain calm and easy to read

Text must feel modern, clean, and slightly playful, but never childish.

---

### Panels / cards / framed sections

Encadrés must structure the interface clearly.

Guidelines:

- panels should contrast with the main background while staying in the same night universe
- use dark surfaces slightly lighter than the page background
- panels may include subtle glow, edge light, or soft neon contour
- corners should feel modern and friendly rather than rigid
- spacing must be generous to avoid a cramped arcade effect
- panels must remain readable even without decorative effects

A panel is a clean container first, a visual effect second.

---

## 3. Semantic states

### Error messages

Error messages must be immediately visible and unambiguous.

Guidelines:

- error areas must strongly contrast with normal content
- use a warm alert family for error emphasis
- combine three levels clearly:
  - background tone
  - border or framed edge
  - text color
- error text must be easy to scan quickly
- the style must feel serious and visible, but not destructive or alarming
- avoid overly dark red on black if readability suffers

Errors should feel like a clear warning inside a polished interface.

---

### Selected div states

Selected blocks must be visually obvious.

Guidelines:

- selected items should stand out instantly from non-selected ones
- selection should rely on a brighter edge, glow, border, or light pulse
- the selected state must feel linked to the neon identity of BlindUp
- selection must remain elegant and not flash aggressively
- selected blocks must still preserve text readability
- do not rely on color alone if structure can help too

The selected state should feel like a stage spotlight.

---

## 4. Buttons

Buttons must express energy, clarity, and action.

Guidelines:

- buttons should feel lively and modern
- primary buttons may use the strongest neon/accent treatment
- secondary buttons should stay quieter and more structural
- danger or destructive buttons must be clearly distinct from playful actions
- hover, focus, and active states must be clearly differentiated
- the shape should feel dynamic and friendly, not corporate or flat
- button labels must remain short, bold, and highly legible

Buttons should evoke:

- music show controls
- game momentum
- host energy
- instant action

They must feel fun without looking messy.

---

## 5. Accent color logic

The color system should be inspired by the logo.

Recommended visual families:

- deep night blues for structure
- electric cyan / neon blue for modern energy
- vivid pink / magenta for playful highlights
- warm orange / coral for fun and rhythm
- bright yellow only in small strategic accents
- soft white / cool white for readable text and contrast

Rules:

- do not use all accent colors equally at the same time
- one main accent and one secondary accent should dominate a screen
- neon colors must guide attention, not decorate every element
- the UI must still work when glow effects are reduced

---

## 6. Contrast and readability

BlindUp is visually expressive, but usability stays first.

Guidelines:

- all important text must remain readable on dark surfaces
- do not place neon text directly on highly saturated neon backgrounds
- glowing effects must never blur labels or icons
- functional content always has priority over decoration
- dark mode contrast must be tested on mobile and desktop

The interface must remain practical for real use during a live game.

---

## 7. Styling philosophy for implementation

When converting this guide into HTML/CSS:

- build a stable dark base first
- add accents second
- add glow effects last
- keep component states consistent
- avoid multiplying effect styles unnecessarily
- prefer a small number of strong visual rules reused everywhere

BlindUp should feel like a coherent neon stage, not a collage of flashy widgets.