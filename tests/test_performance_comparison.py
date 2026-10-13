"""The home page's performance comparison: which funds qualify (decided by the data), which share class each column uses, and the cache
(stale while revalidate; an empty build never replaces a good one)."""
import time

import pytest

from services import performance as perf


def _rows(label, start_day, n, nav0=100.0, step=0.5):
    return [{"share_class": label, "nav_date": f"2026-09-{start_day + i:02d}", "nav": str(nav0 + step * i), "source": "x"} for i in range(n)]


def test_funds_qualify_by_having_a_recent_nav_not_by_a_list():
    funds = [{"id": 1, "nav_date": "2026-10-08"}, {"id": 2, "nav_date": "2026-10-01"}, {"id": 3, "nav_date": "2026-08-19"},
             {"id": 4, "nav_date": None}, {"id": 5, "nav_date": "2025-07-31"}]
    assert perf.candidates(funds) == [1, 2]                     # within 30 days of the newest NAV of any fund
    assert perf.candidates(funds, window_days=100) == [1, 2, 3]
    assert perf.candidates([{"id": 1, "nav_date": None}]) == []


def test_rows_with_no_share_class_are_old_snapshots_and_are_not_a_series():
    series = perf._series_by_label(_rows("Direct", 1, 5) + [{"share_class": None, "nav_date": "2026-09-01", "nav": "50", "source": "x"}])
    assert list(series) == ["Direct"] and len(series["Direct"]) == 5 and series["Direct"] == sorted(series["Direct"])


def test_direct_is_the_direct_class_and_regular_the_regular_one():
    series = perf._series_by_label(_rows("Regular", 1, 4) + _rows("Direct", 1, 6))
    picked = perf.pick_classes(series, [])
    assert picked["Direct"]["label"] == "Direct" and picked["Regular"]["label"] == "Regular"


def test_a_fund_without_plan_names_uses_its_first_listed_class_for_both_views():
    series = perf._series_by_label(_rows("Class B1", 1, 9) + _rows("Class A1", 1, 5))
    picked = perf.pick_classes(series, [{"class_name": "Class A1"}, {"class_name": "Class B1"}])
    assert picked["Direct"]["label"] == "Class A1" and picked["Regular"] is None
    assert perf.pick_classes(series, [])["Direct"]["label"] == "Class B1"          # nothing listed: the longest series


def test_a_fund_with_no_dated_series_gives_no_column():
    assert perf.fund_column({"id": 9, "fund_name": "X", "nav_history": [{"share_class": None, "nav_date": "2026-09-01", "nav": "50"}]}) is None
    assert perf.fund_column({"id": 9, "fund_name": "X", "nav_history": []}) is None


def test_a_column_carries_what_the_table_shows():
    fund = {"id": 7, "fund_name": "Test Fund", "amc_name": "AMC", "nav_history": _rows("Direct", 1, 5), "share_classes": [],
            "aum_usd": "1000000", "aum_date": "2026-09-30", "inception_date": "2025-09-18"}
    col = perf.fund_column(fund)
    assert col["fund_id"] == 7 and col["aum"] == 1000000.0 and col["aum_date"] == "2026-09-30" and col["classes"]["Direct"]["points"][0][0] == "2026-09-01"


@pytest.fixture()
def fresh_cache(monkeypatch):
    monkeypatch.setitem(perf._cache, "at", 0.0)
    monkeypatch.setitem(perf._cache, "value", None)
    monkeypatch.setattr(perf, "_refreshing", False)


def test_the_cache_serves_the_last_good_copy_and_never_replaces_it_with_an_empty_build(fresh_cache, monkeypatch):
    builds = []
    results = iter([{"funds": [{"fund_id": 1}], "requested": 1}, {"funds": [], "requested": 1}])
    monkeypatch.setattr(perf, "_build", lambda: builds.append(1) or next(results))
    first = perf.get_comparison()
    assert first["funds"] and len(builds) == 1
    assert perf.get_comparison() is first and len(builds) == 1                          # fresh: no second build
    monkeypatch.setitem(perf._cache, "at", time.time() - perf.CACHE_SECONDS - 1)         # stale
    assert perf.get_comparison() is first                                               # served at once ...
    for _ in range(50):                                                                 # ... while a refresh runs in the background
        if len(builds) == 2:
            break
        time.sleep(0.05)
    assert len(builds) == 2
    time.sleep(0.2)
    assert perf._cache["value"] is first                                                # the empty refresh did not replace the good copy
