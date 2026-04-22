"""Regression tests for audit item #8 — the 500-condition ILIKE storm.

Before migration 016 + the chat/hsl/aio rewrites, the AIO-search
fallback built a WHERE clause like:

    element_1 ILIKE %s OR element_2 ILIKE %s OR ... OR element_50 ILIKE %s

repeated for up to 10 needles → 500 unindexed predicates per query.
These tests pin the fix in place: the offending pattern must not
re-appear in the codebase, and the replacement single-column
`elements_text` form must be present in every hot path.

Text-level assertions are intentionally simple — they'd catch a
revert or an accidental copy-paste regression without needing a live
database.
"""

from __future__ import annotations

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
CHAT_PY = REPO_ROOT / "api" / "routes" / "chat.py"
HSL_PY = REPO_ROOT / "api" / "routes" / "hsl.py"
AIO_PY = REPO_ROOT / "api" / "routes" / "aio.py"
MIGRATION = REPO_ROOT / "migrations" / "016_search_text_gin.sql"


# Match the old storm: a loop that expands `element_N ILIKE %s` over
# range(1, 51) inside a SELECT construction. Comments/docstrings that
# mention the shape are fine; real code was the `for i in range(1, 51)`
# with `element_{i} ILIKE`.
_STORM = re.compile(
    r"for\s+i\s+in\s+range\(1,\s*51\).*element_\{i\}\s*ILIKE",
    re.DOTALL,
)


def test_migration_016_exists():
    assert MIGRATION.is_file(), "migration 016 (GIN on elements_text) missing"
    sql = MIGRATION.read_text()
    assert "CREATE EXTENSION IF NOT EXISTS pg_trgm" in sql
    assert "elements_text" in sql
    assert "gin_trgm_ops" in sql


def test_chat_aio_search_has_no_ilike_storm():
    src = CHAT_PY.read_text()
    assert not _STORM.search(src), (
        "aio-search fallback is reconstructing the 500-ILIKE storm; "
        "it should use `elements_text LIKE %s` against the GIN index."
    )
    assert "elements_text LIKE %s" in src


def test_hsl_find_by_needles_is_indexed():
    src = HSL_PY.read_text()
    # The old implementation fetched 1000 rows and filtered in Python.
    # The new one pushes a LIKE predicate per needle into SQL.
    assert "elements_text LIKE %s" in src
    assert "for row in cur.fetchall()" not in src.split(
        "def find_hsls_by_needles", 1)[-1].split("def ", 1)[0], (
        "find_hsls_by_needles should filter in SQL, not Python"
    )


def test_sync_information_elements_uses_single_predicate():
    """_sync_information_elements must hit `elements_text`, not a 50-col OR."""
    src = AIO_PY.read_text()
    # Isolate just this function's body.
    body = src.split("def _sync_information_elements", 1)[-1].split("\ndef ", 1)[0]
    # New implementation:
    assert "elements_text LIKE %s" in body, (
        "_sync_information_elements should LIKE against elements_text"
    )
    # Old implementation (must be gone from the body):
    assert "element_{i} LIKE" not in body
    assert "range(1, 51)" not in body
