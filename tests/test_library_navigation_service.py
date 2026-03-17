import pytest

from app.services.library_navigation_service import build_library_folder_tree


def test_build_library_folder_tree_returns_sorted_tree_and_direct_audio_counts(
    tmp_path,
) -> None:
    root = tmp_path / "music"
    root.mkdir()
    (root / "z-last").mkdir()
    (root / "a-first").mkdir()
    (root / "a-first" / "nested").mkdir()
    (root / "track.mp3").write_text("root", encoding="utf-8")
    (root / "ignore.txt").write_text("skip", encoding="utf-8")
    (root / "a-first" / "album.flac").write_text("album", encoding="utf-8")
    (root / "a-first" / "nested" / "live.m4a").write_text("live", encoding="utf-8")

    tree = build_library_folder_tree(root)

    assert tree == {
        "path": str(root.resolve()),
        "name": "music",
        "depth": 0,
        "direct_audio_files": 1,
        "children": [
            {
                "path": str((root / "a-first").resolve()),
                "name": "a-first",
                "depth": 1,
                "direct_audio_files": 1,
                "children": [
                    {
                        "path": str((root / "a-first" / "nested").resolve()),
                        "name": "nested",
                        "depth": 2,
                        "direct_audio_files": 1,
                        "children": [],
                    }
                ],
            },
            {
                "path": str((root / "z-last").resolve()),
                "name": "z-last",
                "depth": 1,
                "direct_audio_files": 0,
                "children": [],
            },
        ],
    }


def test_build_library_folder_tree_raises_for_missing_root(tmp_path) -> None:
    with pytest.raises(FileNotFoundError):
        build_library_folder_tree(tmp_path / "missing")


def test_build_library_folder_tree_raises_for_non_directory_root(tmp_path) -> None:
    root_file = tmp_path / "library.txt"
    root_file.write_text("not a directory", encoding="utf-8")

    with pytest.raises(NotADirectoryError):
        build_library_folder_tree(root_file)
