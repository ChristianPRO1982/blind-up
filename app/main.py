from fastapi import FastAPI
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.db import init_db

init_db()
app = FastAPI(title=settings.project_name)
app.mount("/static", StaticFiles(directory=settings.static_dir), name="static")


@app.get("/", include_in_schema=False)
async def root() -> RedirectResponse:
    return RedirectResponse(url="/static/index.html")


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
