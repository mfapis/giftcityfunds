"""Which funds are verified: the ones listed in data/verified_funds.json (checked against the fund house's latest factsheet and notices).

A fund is verified only when its id and its normalised name both match the list, so a fund that is deleted and re-created under the same
id does not inherit the claim. Everything else is a directory listing and is shown as such.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict, Optional

_PATH = Path(__file__).resolve().parent.parent / "data" / "verified_funds.json"
_cache: Optional[Dict[str, Any]] = None


def _norm(name: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(name or "").lower())


def _load() -> Dict[str, Any]:
    global _cache
    if _cache is None:
        try:
            doc = json.loads(_PATH.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            doc = {}
        _cache = {
            "by_id": {int(f["id"]): _norm(f.get("name")) for f in doc.get("funds", []) if "id" in f},
            "as_of": doc.get("verified_as_of"),
            "basis": doc.get("basis"),
        }
    return _cache


def is_verified(fund_id: Any, fund_name: Any) -> bool:
    try:
        expected = _load()["by_id"].get(int(fund_id))
    except (TypeError, ValueError):
        return False
    return expected is not None and expected == _norm(fund_name)


def info() -> Dict[str, Any]:
    d = _load()
    return {"count": len(d["by_id"]), "as_of": d["as_of"], "basis": d["basis"]}
