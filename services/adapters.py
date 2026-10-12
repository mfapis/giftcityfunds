"""
services/adapters.py

Translates mf-engine-v2's GIFT City response shape into the exact field names
GIFT360's existing frontend JavaScript and templates already expect, so the
UI needs no changes at all when the data source moves from local SQLite to
the shared API.

Where the two schemas genuinely disagree, the mapping is documented inline
rather than silently guessed. Two fields have no mf-engine equivalent and are
deliberately dropped rather than faked:

  source_tier   -- scraper provenance (tier1_amc / tier2_directory), never
                   carried into the production schema. The tier filter is
                   being removed from the UI accordingly.
  demo holdings -- the Buy simulator / demo portfolio is being removed
                   entirely; nothing in mf-engine backs it.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional


def _num(value: Any) -> Optional[float]:
    """mf-engine returns Decimals as JSON strings ("0.30"); the frontend
    expects real numbers. Returns None rather than 0 for missing values so
    'no data' stays visually distinct from 'zero'."""
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _date(value: Any) -> Optional[str]:
    """ISO timestamps ("2026-03-20T00:00:00.000Z") -> plain dates
    ("2026-03-20"), which is what the old SQLite columns held and what the
    frontend's date formatting assumes."""
    if not value or not isinstance(value, str):
        return value
    return value.split("T")[0]


def _direct_share_class(share_classes: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """The old schema had one fund-level expense_ratio; the new one keeps TER
    per share class. Prefer the Direct class (what the old single number
    effectively represented), else fall back to the first class."""
    if not share_classes:
        return None
    for sc in share_classes:
        name = (sc.get("class_name") or "").lower()
        if "direct" in name:
            return sc
    return share_classes[0]


def fund_summary(fund: Dict[str, Any]) -> Dict[str, Any]:
    """Maps one fund from the list endpoint into the frontend's expected shape."""
    share_classes = fund.get("share_classes") or []
    direct = _direct_share_class(share_classes)
    category_obj = fund.get("category") or {}

    return {
        # id -> fund_id: the frontend builds URLs and compares on fund_id
        "fund_id": fund.get("id"),
        "fund_name": fund.get("fund_name"),
        "amc_name": fund.get("amc_name") or (fund.get("amc") or {}).get("name"),
        # The old free-text `category` maps best to fund_type ('Retail MF',
        # 'AIF Cat III', ...), with the category lookup table as a fallback.
        "category": fund.get("fund_type") or category_obj.get("name"),
        "structure": fund.get("structure"),
        # inception_date -> launch_date (the old column name)
        "launch_date": _date(fund.get("inception_date")),
        "inception_date": _date(fund.get("inception_date")),
        "nav": _num(fund.get("nav")),
        "nav_currency": fund.get("base_currency"),
        "nav_as_of": _date(fund.get("nav_date")),
        # Fund-level expense_ratio no longer exists -- derived from the
        # Direct share class's TER, which is what it represented.
        "expense_ratio": _num(direct.get("ter_pct")) if direct else None,
        "aum": _num(fund.get("aum_usd")),
        "aum_currency": "USD" if fund.get("aum_usd") is not None else None,
        "aum_date": _date(fund.get("aum_date")),
        "aum_unit": None,
        "fund_flow_type": fund.get("fund_flow_type"),
        "benchmark_index": fund.get("benchmark_index"),
        "fund_manager": fund.get("fund_manager"),
        "isin": fund.get("isin"),
        "minimum_investment": _num(fund.get("min_investment_usd")),
        "source_url": fund.get("factsheet_url"),
        "source_name": (fund.get("amc") or {}).get("name") or fund.get("amc_name"),
        "plan_type": (direct or {}).get("class_name") or "—",
    }


def _allocations_by_type(allocations: List[Dict[str, Any]], wanted: str) -> List[Dict[str, Any]]:
    """The old API returned separate geographic_/sector_/... lists; the new
    one returns one array tagged with allocation_type. Splitting it back out
    keeps the frontend unchanged.

    Verified against live API data: allocation_type values are snake_case and
    match the old SQLite schema's names exactly ('geographic', 'sector',
    'asset_class'). The Title-case variants ('Geography', 'MarketCap',
    'Theme') defined in the production migration are also accepted, since
    both spellings can appear depending on which loader wrote the row."""
    mapping = {
        "geographic": {"geographic", "geography"},
        "sector": {"sector"},
        "market_cap": {"market_cap", "marketcap"},
        "asset_class": {"asset_class", "assetclass", "theme"},
        "credit_quality": {"credit_quality", "creditquality"},
    }
    accepted = {a.replace("_", "").lower() for a in mapping.get(wanted, {wanted})}
    rows = [
        a for a in allocations
        if (a.get("allocation_type") or "").replace("_", "").replace(" ", "").lower() in accepted
    ]
    return [
        {
            "breakdown_type": wanted,
            "category": a.get("category"),
            "weight_pct": _num(a.get("weight_pct")),
            "as_of_date": _date(a.get("as_of_date")),
            "source_name": None,
            "holdings_basis": "fund_direct",
        }
        for a in sorted(rows, key=lambda r: _num(r.get("weight_pct")) or 0, reverse=True)
    ]


def fund_detail(fund: Dict[str, Any], all_funds: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Maps the detail endpoint's response into the frontend's expected shape,
    including the related-funds list the old endpoint built with a SQL query."""
    detail = fund_summary(fund)
    share_classes = fund.get("share_classes") or []
    allocations = fund.get("allocations") or []

    detail["effective_min_investment_usd"] = _num(fund.get("min_investment_usd"))

    # Related funds from the same AMC -- computed client-side from the cached
    # list, since mf-engine has no equivalent endpoint for GIFT City funds.
    amc = detail.get("amc_name")
    related = [
        {
            "fund_id": f.get("id"),
            "fund_name": f.get("fund_name"),
            "nav": _num(f.get("nav")),
            "nav_currency": f.get("base_currency"),
            "category": f.get("fund_type"),
        }
        for f in all_funds
        if f.get("amc_name") == amc and f.get("id") != fund.get("id")
    ][:5]
    detail["related_funds"] = related

    detail["holdings"] = [
        {
            "holding_name": h.get("holding_name"),
            "weight_pct": _num(h.get("weight_pct")),
            "rank": i + 1,
            "as_of_date": _date(h.get("as_of_date")),
            "source_name": None,
            "holdings_basis": "fund_direct",
            "sector": h.get("sector"),
            "country": h.get("country"),
        }
        for i, h in enumerate(
            sorted(fund.get("holdings") or [], key=lambda r: _num(r.get("weight_pct")) or 0, reverse=True)
        )
    ]

    detail["geographic_allocation"] = _allocations_by_type(allocations, "geographic")
    detail["sector_allocation"] = _allocations_by_type(allocations, "sector")
    detail["market_cap_allocation"] = _allocations_by_type(allocations, "market_cap")
    detail["asset_class_allocation"] = _allocations_by_type(allocations, "asset_class")
    detail["credit_quality_allocation"] = _allocations_by_type(allocations, "credit_quality")

    # Taxation: the old API returned a single row or None. mf-engine keeps
    # dated history plus flat current values on the fund itself -- prefer the
    # most recent history row, fall back to the flat fields.
    tax_history = fund.get("taxation") or fund.get("taxation_history") or []
    if tax_history:
        latest = sorted(tax_history, key=lambda t: t.get("as_of_date") or "", reverse=True)[0]
        detail["taxation"] = {
            "ltcg_rate": _num(latest.get("ltcg_tax_pct")),
            "stcg_rate": _num(latest.get("stcg_tax_pct")),
            "dividend_rate": _num(latest.get("dividend_tax_pct")),
            "tax_notes": latest.get("tax_notes"),
            "as_of_date": _date(latest.get("as_of_date")),
            "source_name": None,
        }
    elif fund.get("ltcg_tax_pct") is not None or fund.get("stcg_tax_pct") is not None:
        detail["taxation"] = {
            "ltcg_rate": _num(fund.get("ltcg_tax_pct")),
            "stcg_rate": _num(fund.get("stcg_tax_pct")),
            "dividend_rate": None,
            "tax_notes": None,
            "as_of_date": None,
            "source_name": None,
        }
    else:
        detail["taxation"] = None

    detail["performance"] = [
        {
            "period": p.get("period"),
            "fund_return_pct": _num(p.get("fund_return_pct")),
            "benchmark_return_pct": _num(p.get("benchmark_return_pct")),
            "excess_return_pct": _num(p.get("excess_return_pct")),
            "share_class": p.get("share_class"),
            "currency": p.get("currency"),
            "is_annualized": p.get("is_annualized"),
            "as_of_date": _date(p.get("as_of_date")),
            "source_name": None,
        }
        for p in (fund.get("performance") or [])
    ]

    detail["risk_metrics"] = [
        {
            "period": r.get("period"),
            "alpha_pct": _num(r.get("alpha_pct")),
            "beta": _num(r.get("beta")),
            "r_squared": _num(r.get("r_squared")),
            "tracking_error_pct": _num(r.get("tracking_error_pct")),
            "information_ratio": _num(r.get("information_ratio")),
            "sharpe_ratio": _num(r.get("sharpe_ratio")),
            "upside_capture_pct": _num(r.get("upside_capture_pct")),
            "downside_capture_pct": _num(r.get("downside_capture_pct")),
            "active_share_pct": _num(r.get("active_share_pct")),
            "batting_average_pct": _num(r.get("batting_average_pct")),
            "as_of_date": _date(r.get("as_of_date")),
            "source_name": None,
        }
        for r in (fund.get("risk_metrics") or [])
    ]

    detail["share_classes"] = [
        {
            "class_name": sc.get("class_name"),
            "investor_type": sc.get("investor_type"),
            "min_investment_usd": _num(sc.get("min_investment_usd")),
            "management_fee_pct": _num(sc.get("management_fee_pct")),
            "performance_fee_pct": _num(sc.get("performance_fee_pct")),
            "hurdle_rate_pct": _num(sc.get("hurdle_rate_pct")),
            "ter_pct": _num(sc.get("ter_pct")),
            "nav": _num(sc.get("nav")),
            "nav_date": _date(sc.get("nav_date")),
            # These three existed only in the old SQLite schema; mf-engine
            # doesn't model a subscription/redemption NAV split. Left None
            # rather than fabricated.
            "subscription_nav": None,
            "redemption_nav_long_term": None,
            "redemption_nav_short_term": None,
            "exit_load_pct": _num(sc.get("exit_load_pct")),
            "exit_load_months": sc.get("exit_load_months"),
            "lock_in_months": sc.get("lock_in_months"),
            "isin": sc.get("isin"),
            "source_name": None,
        }
        for sc in share_classes
    ]

    return detail


def nav_history(fund: Dict[str, Any]) -> List[Dict[str, Any]]:
    """The old frontend called a separate /nav-history endpoint; mf-engine
    returns the series inline on the detail response. This reshapes it to the
    same rows the old endpoint produced, oldest first."""
    rows = [
        {
            "nav_date": _date(p.get("nav_date")),
            "nav": _num(p.get("nav")),
            # the share class the NAV belongs to: the returns table is calculated per class (None = an old one-off snapshot)
            "share_class": p.get("share_class"),
            "nav_currency": fund.get("base_currency") or "USD",
            "source_name": p.get("source"),
        }
        for p in (fund.get("nav_history") or [])
        if p.get("nav") is not None and p.get("nav_date")
    ]
    return sorted(rows, key=lambda r: r["nav_date"] or "")
