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

The application is exposed on port `8000`.

## Project layout

```text
blindup/
├─ app/
│  ├─ config.py
│  ├─ db.py
│  ├─ main.py
│  └─ static/
├─ docs/
├─ tests/
├─ Dockerfile
├─ docker-compose.yml
├─ pyproject.toml
└─ README.md
```
