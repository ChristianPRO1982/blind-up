import threading
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from app.config import settings
from app.db import init_db
from app.repositories import blindtest_repository, song_repository
from app.services.library_scan_service import ScanCancelled, scan_library


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


settings.storage_dir.mkdir(parents=True, exist_ok=True)
app = FastAPI(title=settings.project_name, lifespan=lifespan)
app.mount("/static", StaticFiles(directory=settings.static_dir), name="static")
app.mount("/media", StaticFiles(directory=settings.storage_dir), name="media")


@app.get("/", include_in_schema=False)
async def root() -> RedirectResponse:
    return RedirectResponse(url="/static/index.html")


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


class LibraryScanRequest(BaseModel):
    root_path: str


class BlindtestSongPayload(BaseModel):
    song_id: int | None = None
    order_index: int
    slot_status: str = "ok"
    start_sec: float | None = None
    duration_sec: float | None = None
    source_title: str | None = None
    source_artist: str | None = None
    source_album: str | None = None
    source_year: int | None = None
    source_genre: str | None = None
    source_cover: str | None = None
    override_title: str | None = None
    override_artist: str | None = None
    override_album: str | None = None
    override_year: int | None = None
    override_genre: str | None = None
    override_cover: str | None = None
    custom_hint: str | None = None


class BlindtestPayload(BaseModel):
    id: int | None = None
    title: str = ""
    background_image: str | None = None
    game_mode: str = "blind_test"
    pre_play_delay_sec: float = 0.0
    auto_enabled_default: bool = False
    hints_enabled_default: bool = True
    answer_timer_enabled: bool = False
    answer_duration_sec: float = 10.0
    round3_step_durations: str = "0.5,1,1.5,2,3,4,5"
    round3_step_gap_sec: float = 3.0
    round3_progression_mode: str = "fixed_start"
    songs: list[BlindtestSongPayload] = Field(default_factory=list)


class LibraryScanController:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._worker: threading.Thread | None = None
        self._cancel_event: threading.Event | None = None
        self._status = "idle"
        self._summary: dict[str, object] | None = None
        self._error: str | None = None

    def _run_scan(self, root_path: str, cancel_event: threading.Event) -> None:
        try:
            summary = scan_library(root_path, cancel_event)
        except ScanCancelled:
            with self._lock:
                self._status = "idle"
                self._error = "Scan stopped"
        except FileNotFoundError as exc:
            with self._lock:
                self._status = "error"
                self._error = f"Invalid root path: {exc}"
        except Exception as exc:
            with self._lock:
                self._status = "error"
                self._error = str(exc)
        else:
            with self._lock:
                self._status = "idle"
                self._summary = summary.as_dict()
                self._error = None
        finally:
            with self._lock:
                self._worker = None
                self._cancel_event = None

    def start(self, root_path: str) -> dict[str, object]:
        with self._lock:
            if self._worker is not None and self._worker.is_alive():
                raise RuntimeError("Scan already running")

            cancel_event = threading.Event()
            worker = threading.Thread(
                target=self._run_scan,
                args=(root_path, cancel_event),
                daemon=True,
            )
            self._worker = worker
            self._cancel_event = cancel_event
            self._status = "running"
            self._error = None

        worker.start()
        return {"status": "running"}

    def stop(self) -> dict[str, object]:
        with self._lock:
            if (
                self._worker is None
                or not self._worker.is_alive()
                or self._cancel_event is None
            ):
                return {"status": "idle"}

            self._cancel_event.set()
            self._status = "stopping"
            return {"status": "stopping"}

    def snapshot(self) -> dict[str, object]:
        with self._lock:
            return {
                "status": self._status,
                "summary": self._summary,
                "error": self._error,
            }


library_scan_controller = LibraryScanController()


@app.post("/api/library/scan/start")
async def library_scan_start(payload: LibraryScanRequest) -> dict[str, object]:
    try:
        return library_scan_controller.start(payload.root_path)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.post("/api/library/scan/stop")
async def library_scan_stop() -> dict[str, object]:
    return library_scan_controller.stop()


@app.get("/api/library/scan/status")
async def library_scan_status() -> dict[str, object]:
    return library_scan_controller.snapshot()


@app.get("/api/songs")
async def songs() -> dict[str, list[dict[str, object]]]:
    song_repository.normalize_song_media_paths()
    return {
        "songs": [
            {
                "id": song["id"],
                "title": song["title"],
                "artist": song["artist"],
                "album": song["album"],
                "year": song["year"],
                "genre": song["genre"],
                "cover_path": song["cover_path"],
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


@app.get("/api/blindtests")
async def blindtests() -> dict[str, list[dict[str, object]]]:
    return {"blindtests": blindtest_repository.list_blindtests()}


@app.get("/api/blindtest/{blindtest_id}")
async def get_blindtest(blindtest_id: int) -> dict[str, object]:
    song_repository.normalize_song_media_paths()
    blindtest = blindtest_repository.get_blindtest(blindtest_id)
    if blindtest is None:
        raise HTTPException(status_code=404, detail="Blindtest not found")

    blindtest_repository.normalize_blindtest_media(blindtest_id)
    blindtest_repository.validate_blindtest_links(blindtest_id)
    blindtest = blindtest_repository.get_blindtest(blindtest_id)
    return {"blindtest": blindtest}


@app.post("/api/blindtest")
async def save_blindtest(payload: BlindtestPayload) -> dict[str, object]:
    blindtest = blindtest_repository.save_blindtest(
        blindtest_repository.BlindtestRecord(
            id=payload.id,
            title=payload.title,
            background_image=payload.background_image,
            game_mode=payload.game_mode,
            pre_play_delay_sec=payload.pre_play_delay_sec,
            auto_enabled_default=payload.auto_enabled_default,
            hints_enabled_default=payload.hints_enabled_default,
            answer_timer_enabled=payload.answer_timer_enabled,
            answer_duration_sec=payload.answer_duration_sec,
            round3_step_durations=payload.round3_step_durations,
            round3_step_gap_sec=payload.round3_step_gap_sec,
            round3_progression_mode=payload.round3_progression_mode,
            songs=[
                blindtest_repository.BlindtestSongRecord(
                    song_id=song.song_id,
                    order_index=song.order_index,
                    slot_status=song.slot_status,
                    start_sec=song.start_sec,
                    duration_sec=song.duration_sec,
                    source_title=song.source_title,
                    source_artist=song.source_artist,
                    source_album=song.source_album,
                    source_year=song.source_year,
                    source_genre=song.source_genre,
                    source_cover=song.source_cover,
                    override_title=song.override_title,
                    override_artist=song.override_artist,
                    override_album=song.override_album,
                    override_year=song.override_year,
                    override_genre=song.override_genre,
                    override_cover=song.override_cover,
                    custom_hint=song.custom_hint,
                )
                for song in payload.songs
            ],
        )
    )
    return {"status": "ok", "blindtest": blindtest}
