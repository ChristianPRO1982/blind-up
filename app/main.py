from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from app.config import settings
from app.db import init_db
from app.repositories import song_repository
from app.services.library_scan_service import scan_library


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


app = FastAPI(title=settings.project_name, lifespan=lifespan)
app.mount("/static", StaticFiles(directory=settings.static_dir), name="static")


@app.get("/", include_in_schema=False)
async def root() -> RedirectResponse:
    return RedirectResponse(url="/static/index.html")


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


class LibraryScanRequest(BaseModel):
    root_path: str


@app.post("/api/library/scan")
async def library_scan(payload: LibraryScanRequest) -> dict[str, object]:
    try:
        summary = scan_library(payload.root_path)
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid root path: {exc}",
        ) from exc

    return {"status": "ok", "summary": summary.as_dict()}


@app.get("/api/songs")
async def songs() -> dict[str, list[dict[str, object]]]:
    return {
        "songs": [
            {
                "id": song["id"],
                "title": song["title"],
                "artist": song["artist"],
                "duration_sec": song["duration_sec"],
            }
            for song in song_repository.list_songs()
        ]
    }


@app.get("/api/audio/{song_id}")
async def audio(song_id: int) -> FileResponse:
    song = song_repository.get_song_by_id(song_id)
    if song is None:
        raise HTTPException(status_code=404, detail="Song not found")

    file_path = Path(str(song["file_path"]))
    if not file_path.is_file():
        raise HTTPException(status_code=404, detail="Audio unavailable")

    return FileResponse(file_path)
