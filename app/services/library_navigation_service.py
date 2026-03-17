from __future__ import annotations

import os
from pathlib import Path

from app.services.audio_metadata_service import is_supported_audio_file


def build_library_folder_tree(root_path: Path) -> dict[str, object]:
    resolved_root = root_path.expanduser().resolve()
    if not resolved_root.exists():
        raise FileNotFoundError(f"library root does not exist: {resolved_root}")
    if not resolved_root.is_dir():
        raise NotADirectoryError(f"library root is not a directory: {resolved_root}")

    root_node = _create_folder_node(resolved_root, 0)
    node_by_path: dict[Path, dict[str, object]] = {resolved_root: root_node}

    for current_root, dirnames, filenames in os.walk(resolved_root):
        dirnames.sort()
        filenames.sort()
        current_path = Path(current_root).resolve()
        current_node = node_by_path.setdefault(
            current_path,
            _create_folder_node(
                current_path, len(current_path.relative_to(resolved_root).parts)
            ),
        )
        current_node["direct_audio_files"] = _count_supported_audio_files(
            current_path, filenames
        )

        for dirname in dirnames:
            child_path = (current_path / dirname).resolve()
            child_node = _create_folder_node(
                child_path, len(child_path.relative_to(resolved_root).parts)
            )
            current_node["children"].append(child_node)
            node_by_path[child_path] = child_node

    return root_node


def _create_folder_node(path: Path, depth: int) -> dict[str, object]:
    return {
        "path": str(path),
        "name": path.name or str(path),
        "depth": depth,
        "direct_audio_files": 0,
        "children": [],
    }


def _count_supported_audio_files(folder_path: Path, filenames: list[str]) -> int:
    count = 0
    for filename in filenames:
        candidate = folder_path / filename
        if is_supported_audio_file(candidate):
            count += 1
    return count
