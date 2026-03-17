import mimetypes
import threading
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field

from app.config import settings
from app.db import init_db
from app.repositories import (
    blindtest_repository,
    song_repository,
)
from app.services.audio_tag_service import AudioTagUpdate, save_audio_tags
from app.services.library_navigation_service import build_library_folder_tree
from app.services.library_scan_service import ScanCancelled, scan_library
from app.services.song_file_service import resolve_song_file_path
from app.services.song_list_export_service import export_song_list_tsv


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


settings.storage_dir.mkdir(parents=True, exist_ok=True)
settings.covers_dir.mkdir(parents=True, exist_ok=True)
app = FastAPI(title=settings.project_name, lifespan=lifespan)
templates = Jinja2Templates(directory=settings.templates_dir)
app.mount("/static", StaticFiles(directory=settings.static_dir), name="static")
app.mount(
    "/media/covers",
    StaticFiles(directory=settings.covers_dir),
    name="media-covers",
)
app.mount("/media", StaticFiles(directory=settings.storage_dir), name="media")

EDITOR_BACKGROUND_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
KNOWN_AUDIO_MEDIA_TYPES = {
    ".aac": "audio/aac",
    ".flac": "audio/flac",
    ".m4a": "audio/mp4",
    ".mp3": "audio/mpeg",
    ".oga": "audio/ogg",
    ".ogg": "audio/ogg",
    ".opus": "audio/ogg",
    ".wav": "audio/wav",
    ".weba": "audio/webm",
    ".wma": "audio/x-ms-wma",
}


def static_asset_version(asset_name: str) -> int:
    asset_path = settings.static_dir / asset_name
    if not asset_path.is_file():
        return 0
    return int(asset_path.stat().st_mtime_ns)


templates.env.globals["static_asset_version"] = static_asset_version


def get_editor_background_gallery() -> list[dict[str, str]]:
    gallery_dir = settings.static_dir / "editor-backgrounds"
    if not gallery_dir.exists():
        return []
    gallery = []
    for file_path in sorted(gallery_dir.iterdir(), key=lambda path: path.name.lower()):
        if (
            not file_path.is_file()
            or file_path.suffix.lower() not in EDITOR_BACKGROUND_EXTENSIONS
        ):
            continue
        gallery.append(
            {
                "name": file_path.stem.replace("_", " ").strip() or file_path.name,
                "url": f"/static/editor-backgrounds/{file_path.name}",
            }
        )
    return gallery


def guess_audio_media_type(file_path: Path) -> str:
    extension = file_path.suffix.lower()
    if extension in KNOWN_AUDIO_MEDIA_TYPES:
        return KNOWN_AUDIO_MEDIA_TYPES[extension]

    guessed_type, _ = mimetypes.guess_type(str(file_path))
    if guessed_type and guessed_type.startswith("audio/"):
        return guessed_type

    return "application/octet-stream"


def _serialize_library_folder_song(song: dict[str, object]) -> dict[str, object]:
    file_path = Path(str(song["file_path"]))
    return {
        "id": song["id"],
        "file_path": song["file_path"],
        "folder_path": str(file_path.parent),
        "file_name": file_path.name,
        "title": song["title"],
        "artist": song["artist"],
        "album": song["album"],
        "year": song["year"],
        "genre": song["genre"],
    }


@app.get("/", include_in_schema=False)
async def root() -> RedirectResponse:
    return RedirectResponse(url="/home")


@app.get("/home", include_in_schema=False)
async def home_page(request: Request):
    return templates.TemplateResponse(
        request,
        "home.html",
        {
            "page_id": "home",
            "page_title": "Home",
        },
    )


@app.get("/scan", include_in_schema=False)
async def scan_page(request: Request):
    return templates.TemplateResponse(
        request,
        "scan.html",
        {
            "page_id": "scan",
            "page_title": "Library scan",
            "scan_root_path": str(settings.library_root_path),
        },
    )


@app.get("/audio-tags", include_in_schema=False)
async def audio_tags_page(request: Request):
    return templates.TemplateResponse(
        request,
        "audio_tags.html",
        {
            "page_id": "audio-tags",
            "page_title": "Audio tag editor",
            "library_root_path": str(settings.library_root_path),
        },
    )


@app.get("/editor/new", include_in_schema=False)
async def editor_new_page(request: Request):
    return templates.TemplateResponse(
        request,
        "editor.html",
        {
            "page_id": "editor",
            "page_title": "Blindtest editor",
            "editor_mode": "new",
            "blindtest_id": None,
            "background_gallery": get_editor_background_gallery(),
        },
    )


@app.get("/editor/{blindtest_id}", include_in_schema=False)
async def editor_page(request: Request, blindtest_id: int):
    return templates.TemplateResponse(
        request,
        "editor.html",
        {
            "page_id": "editor",
            "page_title": "Blindtest editor",
            "editor_mode": "existing",
            "blindtest_id": blindtest_id,
            "background_gallery": get_editor_background_gallery(),
        },
    )


@app.get("/player", include_in_schema=False)
async def player_page(request: Request):
    return templates.TemplateResponse(
        request,
        "player.html",
        {
            "page_id": "player",
            "page_title": "Blindtest player",
        },
    )


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


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
    source_background: str | None = None
    override_title: str | None = None
    override_artist: str | None = None
    override_album: str | None = None
    override_year: int | None = None
    override_genre: str | None = None
    override_background: str | None = None
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


class LibraryScanStartPayload(BaseModel):
    mode: Literal["light", "update"] = "light"


class SongTagUpdatePayload(BaseModel):
    song_id: int
    title: str | None = None
    artist: str | None = None
    album: str | None = None
    year: int | None = None
    genre: str | None = None


class SongTagBatchPayload(BaseModel):
    songs: list[SongTagUpdatePayload] = Field(default_factory=list)


class LibraryScanController:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._worker: threading.Thread | None = None
        self._cancel_event: threading.Event | None = None
        self._status = "idle"
        self._mode: Literal["light", "update"] | None = None
        self._summary: dict[str, object] | None = None
        self._error: str | None = None

    def _run_scan(
        self,
        root_path: str,
        mode: Literal["light", "update"],
        cancel_event: threading.Event,
    ) -> None:
        try:
            summary = scan_library(root_path, cancel_event, mode)
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
                self._mode = None

    def start(
        self,
        root_path: str,
        mode: Literal["light", "update"] = "light",
    ) -> dict[str, object]:
        with self._lock:
            if self._worker is not None and self._worker.is_alive():
                raise RuntimeError("Scan already running")

            cancel_event = threading.Event()
            worker = threading.Thread(
                target=self._run_scan,
                args=(root_path, mode, cancel_event),
                daemon=True,
            )
            self._worker = worker
            self._cancel_event = cancel_event
            self._status = "running"
            self._mode = mode
            self._error = None

        worker.start()
        return {"status": "running", "mode": mode}

    def stop(self) -> dict[str, object]:
        with self._lock:
            if (
                self._worker is None
                or not self._worker.is_alive()
                or self._cancel_event is None
            ):
                return {"status": "idle", "mode": None}

            self._cancel_event.set()
            self._status = "stopping"
            return {"status": "stopping", "mode": self._mode}

    def snapshot(self) -> dict[str, object]:
        with self._lock:
            return {
                "status": self._status,
                "mode": self._mode,
                "summary": self._summary,
                "error": self._error,
            }


library_scan_controller = LibraryScanController()


@app.post("/api/library/scan/start")
async def library_scan_start(
    payload: LibraryScanStartPayload | None = None,
) -> dict[str, object]:
    try:
        mode = payload.mode if payload is not None else "light"
        return library_scan_controller.start(str(settings.library_root_path), mode)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.post("/api/library/scan/stop")
async def library_scan_stop() -> dict[str, object]:
    return library_scan_controller.stop()


@app.get("/api/library/scan/status")
async def library_scan_status() -> dict[str, object]:
    return library_scan_controller.snapshot()


@app.get("/api/library/folders")
async def library_folders() -> dict[str, object]:
    try:
        tree = build_library_folder_tree(settings.library_root_path)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except NotADirectoryError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "root_path": str(settings.library_root_path.expanduser().resolve()),
        "tree": tree,
    }


@app.get("/api/library/folder-songs")
async def library_folder_songs(path: str | None = None) -> dict[str, object]:
    library_root = settings.library_root_path.expanduser().resolve()
    requested_folder = (
        Path(path).expanduser().resolve() if path not in (None, "") else library_root
    )

    if not requested_folder.is_relative_to(library_root):
        raise HTTPException(
            status_code=400,
            detail="Folder must stay inside the library root",
        )
    if not requested_folder.exists():
        raise HTTPException(status_code=404, detail="Folder not found")
    if not requested_folder.is_dir():
        raise HTTPException(status_code=400, detail="Path is not a folder")

    return {
        "folder_path": str(requested_folder),
        "songs": [
            _serialize_library_folder_song(song)
            for song in song_repository.list_songs_in_folder(requested_folder)
        ],
    }


@app.get("/api/songs")
async def songs() -> dict[str, list[dict[str, object]]]:
    song_repository.normalize_song_media_paths()
    return {
        "songs": [
            {
                "id": song["id"],
                "file_path": song["file_path"],
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


@app.post("/api/library/song-tags")
async def library_song_tags(payload: SongTagBatchPayload) -> dict[str, object]:
    updated_songs: list[dict[str, object]] = []

    for update in payload.songs:
        song = song_repository.get_song_by_id(update.song_id)
        if song is None:
            raise HTTPException(
                status_code=404,
                detail=f"Song not found: {update.song_id}",
            )

        file_path = resolve_song_file_path(song)
        if file_path is None or not file_path.is_file():
            raise HTTPException(
                status_code=404,
                detail=f"Audio unavailable for song {update.song_id}",
            )

        try:
            normalized_update = save_audio_tags(
                file_path,
                AudioTagUpdate(
                    title=update.title,
                    artist=update.artist,
                    album=update.album,
                    year=update.year,
                    genre=update.genre,
                ),
            )
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        song_repository.update_song_tags(
            update.song_id,
            normalized_update.title,
            normalized_update.artist,
            normalized_update.album,
            normalized_update.year,
            normalized_update.genre,
        )
        refreshed_song = song_repository.get_song_by_id(update.song_id)
        if refreshed_song is not None:
            updated_songs.append(_serialize_library_folder_song(refreshed_song))

    return {
        "status": "ok",
        "songs": updated_songs,
    }


@app.post("/api/library/song-list")
async def export_song_list() -> dict[str, object]:
    try:
        export_path = export_song_list_tsv(settings.library_root_path)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except NotADirectoryError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Unable to write song list: {exc}",
        ) from exc

    return {
        "status": "ok",
        "path": str(export_path),
        "filename": export_path.name,
    }


@app.get("/api/audio/{song_id}")
async def audio(song_id: int) -> FileResponse:
    song = song_repository.get_song_by_id(song_id)
    if song is None:
        raise HTTPException(status_code=404, detail="Song not found")

    file_path = resolve_song_file_path(song)
    if file_path is None or not file_path.is_file():
        raise HTTPException(status_code=404, detail="Audio unavailable")

    return FileResponse(file_path, media_type=guess_audio_media_type(file_path))


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


@app.delete("/api/blindtest/{blindtest_id}")
async def delete_blindtest(blindtest_id: int) -> dict[str, object]:
    if not blindtest_repository.delete_blindtest(blindtest_id):
        raise HTTPException(status_code=404, detail="Blindtest not found")
    return {"status": "ok"}


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
                    source_background=song.source_background,
                    override_title=song.override_title,
                    override_artist=song.override_artist,
                    override_album=song.override_album,
                    override_year=song.override_year,
                    override_genre=song.override_genre,
                    override_background=song.override_background,
                    custom_hint=song.custom_hint,
                )
                for song in payload.songs
            ],
        )
    )
    return {"status": "ok", "blindtest": blindtest}
