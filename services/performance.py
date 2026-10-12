"""Data for the home page's performance comparison: every fund that has a live daily NAV, one column per fund, each with the NAV series of
its Direct (or headline) and Regular share classes. The returns and volatility are calculated in the page (static/js/returns_table.js), the
same way as on a fund's own page, so the two always agree.

Which funds are included is decided by the data, not by a list: a fund qualifies when it has a NAV on a date within LIVE_WINDOW_DAYS of the
newest NAV date of any fund AND at least one share class with a dated NAV series. Funds that only carry old one-off snapshots (no share
class) are left out.
"""
from __future__ import annotations

import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from typing import Any, Dict, List, Optional

from services import adapters
from services.mf_engine import MfEngineError, fetch_fund, fetch_funds

LIVE_WINDOW_DAYS = 30
CACHE_SECONDS = 15 * 60                  # after this the last good copy is still served while a fresh one is built in the background
MAX_WORKERS = 14                         # every qualifying fund is read at the same time

_cache: Dict[str, Any] = {"at": 0.0, "value": None}
_lock = threading.Lock()


def _parse_date(value: Any) -> Optional[date]:
    try:
        return date.fromisoformat(str(value)[:10]) if value else None
    except ValueError:
        return None


def candidates(funds: List[Dict[str, Any]], window_days: int = LIVE_WINDOW_DAYS) -> List[int]:
    """Ids of the funds whose latest NAV is recent compared with the newest NAV of any fund (a fund list entry carries nav_date)."""
    dated = [(f.get("id"), _parse_date(f.get("nav_date"))) for f in funds if f.get("id") is not None]
    newest = max((d for _, d in dated if d), default=None)
    if newest is None:
        return []
    return [i for i, d in dated if d and d >= newest - timedelta(days=window_days)]


def _series_by_label(nav_history: List[Dict[str, Any]]) -> Dict[str, List[List[Any]]]:
    out: Dict[str, List[List[Any]]] = {}
    for row in nav_history or []:
        label, nav, day = row.get("share_class"), adapters._num(row.get("nav")), adapters._date(row.get("nav_date"))
        if label and nav and nav > 0 and day:
            out.setdefault(label, []).append([day, nav])
    for points in out.values():
        points.sort(key=lambda p: p[0])
    return out


def pick_classes(series: Dict[str, List[List[Any]]], share_classes: List[Dict[str, Any]]) -> Dict[str, Optional[Dict[str, Any]]]:
    """{'Direct': {...}, 'Regular': {...} or None}. 'Direct' is the class labelled direct, else the fund's first listed class that has a NAV
    series (a fund like HDFC India has no Direct/Regular names: its headline class is used for both views), else the longest series."""
    def entry(label):
        return {"label": label, "points": series[label]} if label in series else None

    direct = next((l for l in series if "direct" in l.lower()), None)
    if direct is None:
        listed = [sc.get("class_name") for sc in share_classes or [] if sc.get("class_name") in series]
        direct = listed[0] if listed else max(series, key=lambda l: len(series[l]), default=None)
    regular = next((l for l in series if "regular" in l.lower()), None)
    return {"Direct": entry(direct), "Regular": entry(regular)}


def fund_column(fund: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """One comparison column from a fund's detail record, or None when it has no dated NAV series."""
    series = _series_by_label(fund.get("nav_history"))
    if not series:
        return None
    summary = adapters.fund_summary(fund)
    return {
        "fund_id": fund.get("id"),
        "fund_name": fund.get("fund_name"),
        "amc_name": summary.get("amc_name"),
        "category": summary.get("category"),
        "inception_date": summary.get("inception_date"),
        "aum": summary.get("aum"),
        "aum_date": summary.get("aum_date"),
        "classes": pick_classes(series, fund.get("share_classes") or []),
    }


def _build() -> Dict[str, Any]:
    ids = candidates(fetch_funds())

    def one(fund_id: int):
        try:
            return fund_column(fetch_fund(fund_id) or {})
        except MfEngineError:
            return None

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        columns = [c for c in pool.map(one, ids) if c]
    columns.sort(key=lambda c: (c.get("fund_name") or "").lower())
    return {"funds": columns, "requested": len(ids), "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}


_refreshing = False


def _refresh_in_background() -> None:
    global _refreshing
    try:
        value = _build()
        if value["funds"]:
            with _lock:
                _cache.update(at=time.time(), value=value)
    except Exception:                             # noqa: BLE001 - a failed refresh keeps serving the last good copy
        pass
    finally:
        _refreshing = False


def get_comparison(force: bool = False) -> Dict[str, Any]:
    """Fresh for CACHE_SECONDS; after that the last good copy is returned at once and a new one is built in the background (stale while
    revalidate), so a visitor never waits for the 14 detail reads except on the very first build. An empty build (API down) is never
    cached over a good copy."""
    global _refreshing
    with _lock:
        cached, age = _cache["value"], time.time() - _cache["at"]
        if cached and not force:
            if age >= CACHE_SECONDS and not _refreshing:
                _refreshing = True
                threading.Thread(target=_refresh_in_background, daemon=True).start()
            return cached
    value = _build()
    if value["funds"]:
        with _lock:
            _cache.update(at=time.time(), value=value)
    return value
