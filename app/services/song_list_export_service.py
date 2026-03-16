from __future__ import annotations

import csv
from pathlib import Path

from app.repositories import song_repository

SONG_LIST_FILENAME = "song_list.tsv"
SONG_LIST_COLUMNS = ("file_path", "title", "artist", "album", "year", "genre")


def export_song_list_tsv(root_path: Path) -> Path:
    if not root_path.exists():
        raise FileNotFoundError(f"{root_path} does not exist")
    if not root_path.is_dir():
        raise NotADirectoryError(f"{root_path} is not a directory")

    export_path = root_path / SONG_LIST_FILENAME
    songs = song_repository.list_songs()

    with export_path.open("w", encoding="utf-8", newline="") as export_file:
        writer = csv.writer(export_file, delimiter="\t", lineterminator="\n")
        writer.writerow(SONG_LIST_COLUMNS)
        for song in songs:
            writer.writerow(
                [
                    _format_song_list_value(song.get("file_path")),
                    _format_song_list_value(song.get("title")),
                    _format_song_list_value(song.get("artist")),
                    _format_song_list_value(song.get("album")),
                    _format_song_list_value(song.get("year")),
                    _format_song_list_value(song.get("genre")),
                ]
            )

    return export_path


def _format_song_list_value(value: object) -> str:
    if value is None:
        return ""
    return str(value)
