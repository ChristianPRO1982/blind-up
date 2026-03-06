from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from app.config import settings
from app.db import init_db
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
