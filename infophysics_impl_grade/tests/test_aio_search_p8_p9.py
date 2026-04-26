"""Static checks for V4.4 P8/P9: AIO field-aware probe + env-tunable caps.

P8: AIO gather phase now mirrors HSL Pass 1 with a field-aware compound
    probe against information_element_refs keyed by aio_id.
P9: Retrieval caps (HSL_CAP, HSL_EARLY_EXIT, AIO_CAP, AIO_EARLY_EXIT)
    are read from env vars with the previous hardcoded defaults.
"""

from __future__ import annotations

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
CHAT_PY = REPO_ROOT / "api" / "routes" / "chat.py"


def _src() -> str:
    return CHAT_PY.read_text()


# ── P8: AIO field-aware probe ──────────────────────────────────────

def test_p8_aio_field_aware_probe_present():
    src = _src()
    body = src.split("def _aio_search_prepare", 1)[-1].split("\ndef ", 1)[0]
    # Mirrors the HSL field-aware probe but joins on aio_id.
    assert "ier.aio_id = a.aio_id" in body, (
        "AIO field-aware probe must JOIN information_element_refs on aio_id"
    )
    assert "AIO field-aware probe" in body or "field-aware probe" in body


def test_p8_aio_field_aware_probe_runs_before_elements_text():
    src = _src()
    body = src.split("def _aio_search_prepare", 1)[-1].split("\ndef ", 1)[0]
    field_probe = body.find("ier.aio_id = a.aio_id")
    et_pass = body.find("Pass 1b: elements_text")
    assert field_probe != -1 and et_pass != -1
    assert field_probe < et_pass, (
        "AIO field-aware probe must run before the elements_text pass"
    )


# ── P9: env-tunable caps ───────────────────────────────────────────

def test_p9_caps_are_env_tunable():
    src = _src()
    body = src.split("def _aio_search_prepare", 1)[-1].split("\ndef ", 1)[0]
    for env_name in (
        "AIO_SEARCH_HSL_CAP",
        "AIO_SEARCH_HSL_EARLY_EXIT",
        "AIO_SEARCH_AIO_CAP",
        "AIO_SEARCH_AIO_EARLY_EXIT",
    ):
        assert env_name in body, f"{env_name} env override missing"


def test_p9_defaults_unchanged():
    """The env-driven caps must default to the previous hardcoded values."""
    src = _src()
    body = src.split("def _aio_search_prepare", 1)[-1].split("\ndef ", 1)[0]
    assert '"AIO_SEARCH_HSL_CAP", 500' in body
    assert '"AIO_SEARCH_HSL_EARLY_EXIT", 300' in body
    assert '"AIO_SEARCH_AIO_CAP", 400' in body
    assert '"AIO_SEARCH_AIO_EARLY_EXIT", 350' in body
