import os
from dataclasses import dataclass, field
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


@dataclass(frozen=True)
class Settings:
    project_name: str = "BlindUp"
    database_path: Path = field(
        default_factory=lambda: Path(
            os.getenv("BLINDUP_DB_PATH", BASE_DIR / "blindup.db")
        )
    )
    static_dir: Path = field(
        default_factory=lambda: Path(__file__).resolve().parent / "static"
    )
    storage_dir: Path = field(
        default_factory=lambda: Path(
            os.getenv("BLINDUP_STORAGE_DIR", BASE_DIR / "storage")
        )
    )
    covers_dir: Path | None = None

    def __post_init__(self) -> None:
        if self.covers_dir is None:
            object.__setattr__(
                self,
                "covers_dir",
                Path(os.getenv("BLINDUP_COVERS_DIR", self.storage_dir / "covers")),
            )


settings = Settings()
