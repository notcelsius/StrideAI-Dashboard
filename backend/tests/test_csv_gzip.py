import pytest

from common import is_csv_export, require_csv_upload


# --- require_csv_upload: gates what the app may presign a PUT for -----------

def test_accepts_plain_csv():
    require_csv_upload("track_2026-05-31.csv", "text/csv")


def test_accepts_gzipped_csv():
    require_csv_upload("track_2026-05-31.csv.gz", "application/gzip")
    require_csv_upload("track_2026-05-31.csv.gz", "application/x-gzip")


def test_rejects_gzip_with_csv_content_type():
    # .csv.gz must be declared as gzip, not as CSV — the signed PUT header must match.
    with pytest.raises(ValueError):
        require_csv_upload("track.csv.gz", "text/csv")


def test_rejects_bare_gz():
    # A bare .gz is not a CSV export.
    with pytest.raises(ValueError):
        require_csv_upload("track.gz", "application/gzip")


def test_rejects_non_csv():
    with pytest.raises(ValueError):
        require_csv_upload("notes.txt", "text/plain")
    with pytest.raises(ValueError):
        require_csv_upload("track.csv", "application/gzip")


# --- is_csv_export: keeps gzipped objects in the dashboard manifest ---------

def test_is_csv_export_matches_csv_and_gz():
    assert is_csv_export("track.csv", "text/csv")
    assert is_csv_export("track.csv.gz", "application/gzip")
    # Reading stored metadata back: tolerate a blank/missing content type on .csv.gz.
    assert is_csv_export("track.csv.gz", "")
    assert is_csv_export("track.csv.gz", None)
    # Matches on extension even if a stored content type is generic.
    assert is_csv_export("track.csv", "application/octet-stream")


def test_is_csv_export_rejects_other():
    assert not is_csv_export("track.gz", "application/gzip")
    assert not is_csv_export("notes.txt", "text/plain")
    assert not is_csv_export("", "")
