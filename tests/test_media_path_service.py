from pathlib import Path

import app.config as config_module
from app.services import media_path_service


def test_is_public_media_reference_detects_supported_prefixes() -> None:
    assert media_path_service.is_public_media_reference(None) is False
    assert media_path_service.is_public_media_reference("") is False
    assert media_path_service.is_public_media_reference("/media/covers/a.jpg") is True
    assert media_path_service.is_public_media_reference("/static/app.css") is True
    assert (
        media_path_service.is_public_media_reference("https://example.com/a.jpg")
        is True
    )
    assert media_path_service.is_public_media_reference("/tmp/a.jpg") is False


def test_build_media_url_formats_category_and_filename() -> None:
    assert (
        media_path_service.build_media_url("covers", "a.jpg") == "/media/covers/a.jpg"
    )


def test_import_image_reference_handles_empty_and_existing_public_values(
    monkeypatch,
    tmp_path,
) -> None:
    monkeypatch.setattr(
        media_path_service,
        "settings",
        config_module.Settings(storage_dir=tmp_path / "storage"),
    )

    assert media_path_service.import_image_reference(None, "covers") is None
    assert media_path_service.import_image_reference("   ", "covers") is None
    assert (
        media_path_service.import_image_reference("/media/covers/a.jpg", "covers")
        == "/media/covers/a.jpg"
    )
    assert (
        media_path_service.import_image_reference("/missing/file.jpg", "covers")
        == "/missing/file.jpg"
    )


def test_import_image_reference_copies_file_to_storage(monkeypatch, tmp_path) -> None:
    storage_dir = tmp_path / "storage"
    monkeypatch.setattr(
        media_path_service,
        "settings",
        config_module.Settings(storage_dir=storage_dir),
    )
    source = tmp_path / "cover.JPG"
    source.write_bytes(b"cover")

    public_path = media_path_service.import_image_reference(str(source), "covers")

    assert public_path is not None
    assert public_path.startswith("/media/covers/")
    stored = storage_dir / "covers" / Path(public_path).name
    assert stored.read_bytes() == b"cover"
