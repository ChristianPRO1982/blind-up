import os
from dataclasses import dataclass
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


@dataclass(frozen=True)
class Settings:
    project_name: str = "BlindUp"
    database_path: Path = Path(os.getenv("BLINDUP_DB_PATH", BASE_DIR / "blindup.db"))
    static_dir: Path = Path(__file__).resolve().parent / "static"


settings = Settings()
