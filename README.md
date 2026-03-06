# BlindUp

BlindUp is a local-first music quiz application. This repository currently contains the minimal project foundation described in `docs/`, without gameplay features yet.

## Stack

- Python 3.11
- FastAPI
- SQLite
- HTML, CSS, and vanilla JavaScript
- uv
- pytest
- ruff
- Docker

## Local development

Install dependencies:

```bash
uv sync --dev
```

Run the server:

```bash
uv run uvicorn app.main:app --reload
```

Open:

- `http://127.0.0.1:8000/`
- `http://127.0.0.1:8000/health`
- `http://127.0.0.1:8000/static/index.html`

Run checks:

```bash
uv run pytest -q
uv run ruff check .
```

## Docker

Build and start the app:

```bash
docker compose up --build
```

With Docker Compose, the application is exposed on host port `8500`:

- `http://127.0.0.1:8500/`
- `http://127.0.0.1:8500/health`
- `http://127.0.0.1:8500/static/index.html`

## Project layout

```text
blindup/
├─ .github/
│  └─ workflows/
├─ app/
│  ├─ __init__.py
│  ├─ config.py
│  ├─ db.py
│  ├─ main.py
│  └─ static/
│     ├─ app.js
│     ├─ index.html
│     └─ styles.css
├─ docs/
├─ tests/
│  └─ test_app.py
├─ Dockerfile
├─ docker-compose.yml
├─ pyproject.toml
├─ uv.lock
└─ README.md
```
