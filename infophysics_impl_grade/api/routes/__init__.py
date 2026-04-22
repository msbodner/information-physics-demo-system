"""Router modules for the FastAPI app.

Each module exposes a ``router`` APIRouter that ``main.py`` includes via
``app.include_router(...)``. Route paths, response shapes, and status
codes are preserved verbatim from the pre-refactor monolith.
"""
