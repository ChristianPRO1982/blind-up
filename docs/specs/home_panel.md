# BlindUp — Home Panel

## Objective

Implement the **Home panel**.

This panel is the default entry point of the application.

It allows the host to:

* view all blindtests stored locally
* open a specific blindtest in the editor
* create a new blindtest
* create a new blindtest from a JSON file
* open the Library scan panel

The Home panel is intentionally simple and local-first.

---

# Layout

```
Home Panel
 ├── Header
 ├── Primary actions
 └── Blindtest list
```

---

# 1 Startup Behavior

When the application opens, it must display the **Home panel** first.

The application must **not** automatically open the first blindtest from the database.

Opening a blindtest becomes an explicit host action.

---

# 2 Blindtest List

The Home panel displays the complete list of blindtests stored in the local database.

Rules:

* show all blindtests
* sort by `updated_at` descending
* most recently modified blindtest appears first

Each blindtest row should at minimum display:

* title
* last update information
* an `Open` action

If the database contains no blindtests, the panel shows an empty state inviting the host to create one.

---

# 3 Open Existing Blindtest

When the host clicks `Open` on a blindtest:

* the frontend loads that specific blindtest
* the editor panel becomes visible
* the selected blindtest is loaded into the editor

Opening a blindtest should follow the same lightweight integrity validation rules already defined for the editor:

* validate only slots of the selected blindtest
* do not rescan the full library

---

# 4 Create New Blindtest

The Home panel exposes a `New blindtest` action.

When used:

* the frontend opens the editor panel
* the editor is initialized with a new empty blindtest
* no existing blindtest is preloaded

For MVP, the new blindtest does not need a title before entering the editor.

---

# 5 Navigation

Navigation for this feature is intentionally shallow:

* `Home -> Open -> Editor`
* `Home -> New blindtest -> Editor`
* `Home -> Import JSON -> New blindtest`
* `Home -> Library scan`
* `Editor -> Back -> Home`

The Home panel is the previous screen for the editor in normal usage.

---

# 6 Backend API

The backend must expose a way to list blindtests and a way to fetch one blindtest by identifier.

Suggested endpoints:

```text
GET /api/blindtests
GET /api/blindtest/{id}
```

Expected behavior:

## `GET /api/blindtests`

Returns summary rows ordered by most recent modification first.

Each summary should include at least:

* `id`
* `title`
* `updated_at`

Optional summary fields may be added if useful, but MVP should remain minimal.

Home may also expose an import flow for portable blindtest JSON.

The detailed behavior of JSON import/export is specified separately in:

* `docs/specs/blindtest_json_exchange.md`

## `GET /api/blindtest/{id}`

Returns the full blindtest payload used by the editor.

This replaces the old implicit behavior based on "first blindtest".

The endpoint should:

* normalize image paths if required
* run the lightweight link validation for that blindtest
* return the refreshed blindtest payload

---

# 7 Persistence Impact

No database schema change is required for this feature.

The existing `blindtests.updated_at` field is sufficient to support Home panel ordering.

---

# 8 Correctness

The Home panel is correct if:

* application startup lands on Home, not Editor
* all blindtests are listed
* ordering is newest first by `updated_at`
* opening one blindtest loads that exact blindtest in the editor
* creating a new blindtest opens an empty editor
* editor `Back` returns to Home
