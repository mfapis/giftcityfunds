"""
routes/api.py
The JSON REST API consumed by the frontend's own JavaScript (static/js/*).
Registered under the /api prefix in app.py, so every route here is written
relative to that (e.g. "/funds" serves GET /api/funds).

DATA SOURCE CHANGE: this no longer queries a local SQLite database. Every
route now reads from the shared mf-engine-v2 API (app2.mfapis.club) via
services/mf_engine.py, so GIFT360 and Zinni serve identical numbers from one
source of truth. Partner credentials stay server-side -- the browser only
ever talks to these routes, never to mf-engine directly.

Response shapes are deliberately UNCHANGED from the SQLite version, so the
frontend JS and templates need no edits. services/adapters.py does the field
name translation (id -> fund_id, inception_date -> launch_date, the single
allocations array -> the separate geographic_/sector_/... lists, etc.).

REMOVED in this version:
  - the tier filter (`tier` query param, source_tier): scraper provenance
    that was never carried into the production schema. The corresponding
    UI filter is being removed too.

The demo login / Buy simulator / portfolio routes are KEPT, but their
storage moved from SQLite to Postgres (services/demo_db.py) -- SQLite
can't work on Vercel. The fund data they read (NAV, minimums) now comes
from the mf-engine API like everything else; only the demo-specific rows
(users, profiles, holdings) live in Postgres.

Filtering, sorting and the /stats aggregations now happen in Python over the
fetched list rather than in SQL. The dataset is ~80 funds, so this is
comfortably fast; mf_engine.py caches the list briefly to avoid re-fetching
on every request.
"""

import csv
import io
import json
from typing import Any, Dict, List

from flask import Blueprint, Response, jsonify, request, session

from routes.auth import login_required
from services import adapters, performance, verified
from services.demo_db import DemoDbError, execute, fetch_all, get_db_connection
from services.leads import submit_lead, validate_lead
from services.mf_engine import MfEngineError, fetch_fund, fetch_funds
from services.orders import build_quote, validate_buy_request

api_bp = Blueprint("api", __name__)


def _api_error(exc: MfEngineError):
    """Upstream failures surface as 502 rather than a stack trace, so the
    frontend can show a 'data temporarily unavailable' state."""
    return jsonify({"success": False, "error": str(exc)}), 502


# --- Fund listing, detail, history, comparison ---------------------------

@api_bp.route("/funds")
def get_funds():
    """
    Returns filtered and sorted fund list.
    Query params:
      - q: search term (fund_name, amc_name, category)
      - category: category filter
      - currency: 'USD', 'INR', or 'all'
      - has_nav: 'true' / 'false'
      - flow: 'outbound', 'inbound', or 'all'
      - sort: 'fund_name', 'amc_name', 'nav', 'expense_ratio', 'launch_date', 'category'
      - order: 'asc' / 'desc'
    """
    search_q = request.args.get("q", "").strip().lower()
    cat_filter = request.args.get("category", "all").strip()
    curr_filter = request.args.get("currency", "all").strip().upper()
    has_nav = request.args.get("has_nav", "all").strip().lower()
    flow_filter = request.args.get("flow", "all").strip().lower()
    sort_by = request.args.get("sort", "fund_name").strip().lower()
    order = request.args.get("order", "asc").strip().lower()

    try:
        raw_funds = fetch_funds()
    except MfEngineError as exc:
        return _api_error(exc)

    funds = [adapters.fund_summary(f) for f in raw_funds]

    if search_q:
        funds = [
            f for f in funds
            if search_q in (f.get("fund_name") or "").lower()
            or search_q in (f.get("amc_name") or "").lower()
            or search_q in (f.get("category") or "").lower()
        ]

    if cat_filter and cat_filter.lower() != "all":
        funds = [f for f in funds if cat_filter.lower() in (f.get("category") or "").lower()]

    if curr_filter and curr_filter != "ALL":
        funds = [
            f for f in funds
            if (f.get("nav_currency") or "").upper() == curr_filter
            or (f.get("aum_currency") or "").upper() == curr_filter
        ]

    if has_nav == "true":
        funds = [f for f in funds if f.get("nav") is not None]
    elif has_nav == "false":
        funds = [f for f in funds if f.get("nav") is None]

    if flow_filter in ("outbound", "inbound"):
        funds = [f for f in funds if f.get("fund_flow_type") == flow_filter]

    allowed_sort = {
        "fund_name", "amc_name", "nav", "expense_ratio", "launch_date", "category",
    }
    sort_col = sort_by if sort_by in allowed_sort else "fund_name"
    reverse = order == "desc"

    # NULLs last, matching the old SQL's "CASE WHEN col IS NULL THEN 1" ordering.
    def sort_key(f: Dict[str, Any]):
        value = f.get(sort_col)
        return (value is None, value if value is not None else "")

    funds.sort(key=sort_key, reverse=reverse)

    return jsonify({
        "success": True,
        "count": len(funds),
        "funds": funds,
        "verified_info": verified.info(),
    })


@api_bp.route("/fund/<int:fund_id>")
def get_fund_detail(fund_id: int):
    """Returns single fund details with related funds from same AMC, plus
    portfolio composition, allocations, performance, share classes and
    taxation where the source discloses them."""
    try:
        fund = fetch_fund(fund_id)
        if not fund:
            return jsonify({"success": False, "error": "Fund not found"}), 404
        all_funds = fetch_funds()
    except MfEngineError as exc:
        return _api_error(exc)

    return jsonify({"success": True, "fund": adapters.fund_detail(fund, all_funds)})


@api_bp.route("/fund/<int:fund_id>/nav-history")
def get_fund_nav_history(fund_id: int):
    """Returns the NAV time series for a fund, oldest first. Funds with no
    recorded NAV history return an empty list rather than an error."""
    try:
        fund = fetch_fund(fund_id)
        if not fund:
            return jsonify({"success": False, "error": "Fund not found"}), 404
    except MfEngineError as exc:
        return _api_error(exc)

    history = adapters.nav_history(fund)
    return jsonify({
        "success": True,
        "fund_id": fund_id,
        "fund_name": fund.get("fund_name"),
        "count": len(history),
        "nav_history": history,
    })


@api_bp.route("/performance-comparison")
def performance_comparison():
    """Every fund with a live daily NAV, one column each, with the NAV series of its Direct (or headline) and Regular share classes. The
    page calculates returns and volatility from them. Cached for 15 minutes."""
    try:
        data = performance.get_comparison()
    except MfEngineError as exc:
        return _api_error(exc)
    response = jsonify({"success": True, **data})
    response.headers["Cache-Control"] = "public, max-age=300, s-maxage=900, stale-while-revalidate=3600"
    return response


@api_bp.route("/compare")
def compare_funds():
    """Compares multiple fund IDs passed as comma-separated `ids` parameter."""
    ids_raw = request.args.get("ids", "").strip()
    if not ids_raw:
        return jsonify({"success": False, "error": "No fund IDs provided"}), 400

    fund_ids = [int(i.strip()) for i in ids_raw.split(",") if i.strip().isdigit()]
    if not fund_ids:
        return jsonify({"success": False, "error": "No valid IDs provided"}), 400

    try:
        raw_funds = fetch_funds()
    except MfEngineError as exc:
        return _api_error(exc)

    wanted = set(fund_ids)
    funds = [adapters.fund_summary(f) for f in raw_funds if f.get("id") in wanted]

    return jsonify({"success": True, "count": len(funds), "funds": funds})


@api_bp.route("/stats")
def get_stats():
    """Returns aggregated intelligence statistics and data series for Chart.js charts."""
    try:
        raw_funds = fetch_funds()
    except MfEngineError as exc:
        return _api_error(exc)

    funds = [adapters.fund_summary(f) for f in raw_funds]

    total_funds = len(funds)
    with_nav = sum(1 for f in funds if f.get("nav") is not None)
    with_launch = sum(1 for f in funds if f.get("launch_date"))
    outbound_count = sum(1 for f in funds if f.get("fund_flow_type") == "outbound")
    inbound_count = sum(1 for f in funds if f.get("fund_flow_type") == "inbound")
    distinct_amcs = len({f["amc_name"] for f in funds if f.get("amc_name")})

    # AMC breakdown (Top 10)
    amc_counts: Dict[str, int] = {}
    for f in funds:
        amc = (f.get("amc_name") or "").strip()
        if not amc or amc == "Not Publicly Disclosed":
            continue
        amc_counts[amc] = amc_counts.get(amc, 0) + 1
    amc_distribution = [
        {"amc": amc, "count": count}
        for amc, count in sorted(amc_counts.items(), key=lambda kv: kv[1], reverse=True)[:10]
    ]

    # Category breakdown
    cat_counts: Dict[str, int] = {}
    for f in funds:
        cat = f.get("category") or "Unclassified"
        cat_counts[cat] = cat_counts.get(cat, 0) + 1
    category_distribution = [
        {"category": cat, "count": count}
        for cat, count in sorted(cat_counts.items(), key=lambda kv: kv[1], reverse=True)
    ]

    # Launch timeline by year
    year_counts: Dict[str, int] = {}
    for f in funds:
        launch = f.get("launch_date")
        if not launch:
            continue
        year = str(launch)[:4]
        if year.isdigit():
            year_counts[year] = year_counts.get(year, 0) + 1
    launch_timeline = [
        {"year": year, "count": count} for year, count in sorted(year_counts.items())
    ]

    # Live NAV performers
    nav_performers = sorted(
        [f for f in funds if f.get("nav") is not None],
        key=lambda f: f["nav"],
        reverse=True,
    )

    return jsonify({
        "success": True,
        "summary": {
            "total_funds": total_funds,
            "funds_with_live_nav": with_nav,
            "funds_with_launch_date": with_launch,
            "total_amcs": distinct_amcs,
            "outbound_funds": outbound_count,
            "inbound_funds": inbound_count,
            "unclassified_flow_funds": total_funds - outbound_count - inbound_count,
        },
        "charts": {
            "amc_distribution": amc_distribution,
            "category_distribution": category_distribution,
            "launch_timeline": launch_timeline,
            "nav_performers": nav_performers,
        }
    })



# --- Demo portfolio & "Buy" simulator -------------------------------------
# EVERYTHING BELOW IS A SIMULATION. No real money moves, no real units are
# allotted, nothing is sent to any AMC, bank or transfer agent.

@api_bp.route("/portfolio")
@login_required
def api_portfolio():
    """Returns the logged-in demo user's simulated holdings, with current
    value computed from each fund's latest known NAV. DEMO DATA ONLY.

    Holdings live in Postgres; the fund names and current NAVs are joined in
    from the mf-engine API in Python, since the two now live in separate
    databases and can't be JOINed in SQL."""
    user_id = session["user_id"]
    try:
        with get_db_connection() as conn:
            rows = fetch_all(
                conn,
                """SELECT holding_id, fund_id, units, invested_amount, buy_nav,
                          currency, purchase_date, status
                   FROM demo_holdings WHERE user_id = %s
                   ORDER BY purchase_date DESC""",
                (user_id,),
            )
    except DemoDbError as exc:
        return jsonify({"success": False, "error": str(exc)}), 503

    try:
        fund_lookup = {f["id"]: f for f in fetch_funds()}
    except MfEngineError:
        fund_lookup = {}   # fall back to buy_nav below rather than failing outright

    holdings = []
    total_invested = 0.0
    total_current = 0.0
    for row in rows:
        d = dict(row)
        fund = fund_lookup.get(d["fund_id"]) or {}
        summary = adapters.fund_summary(fund) if fund else {}

        d["units"] = float(d["units"])
        d["invested_amount"] = float(d["invested_amount"])
        d["buy_nav"] = float(d["buy_nav"])
        d["fund_name"] = summary.get("fund_name") or f"Fund #{d['fund_id']}"
        d["amc_name"] = summary.get("amc_name")
        d["nav_currency"] = summary.get("nav_currency") or d["currency"]
        d["nav_as_of"] = summary.get("nav_as_of")

        current_nav = summary.get("nav")
        if current_nav is None:
            current_nav = d["buy_nav"]
        d["current_nav"] = current_nav

        current_value = round(d["units"] * current_nav, 2)
        d["current_value"] = current_value
        d["gain_loss"] = round(current_value - d["invested_amount"], 2)
        d["gain_loss_pct"] = (
            round((current_value - d["invested_amount"]) / d["invested_amount"] * 100, 2)
            if d["invested_amount"] else 0
        )
        total_invested += d["invested_amount"]
        total_current += current_value
        holdings.append(d)

    return jsonify({
        "success": True,
        "user": {"name": session.get("user_name"), "email": session.get("user_email")},
        "holdings": holdings,
        "summary": {
            "total_invested": round(total_invested, 2),
            "total_current_value": round(total_current, 2),
            "total_gain_loss": round(total_current - total_invested, 2),
            "total_gain_loss_pct": (
                round((total_current - total_invested) / total_invested * 100, 2)
                if total_invested else 0
            ),
            "holdings_count": len(holdings),
        }
    })


@api_bp.route("/buy/quote", methods=["POST"])
@login_required
def api_buy_quote():
    """Returns a Payment Summary quote (fee/FX/GST breakdown + demo folio)
    WITHOUT recording anything -- mirrors the real distributor platform's
    'Proceed' step before the final 'Notify for Payment' confirmation.
    DEMO ONLY, no real money or real FX/bank data involved."""
    data = request.get_json(silent=True) or {}
    fund, amount, error = validate_buy_request(data)
    if error:
        return error
    return jsonify({"success": True, "quote": build_quote(fund, amount, session["user_id"])})


@api_bp.route("/buy", methods=["POST"])
@login_required
def api_buy():
    """Simulates a fund purchase order ('Notify for Payment' in the real
    flow). DEMO ONLY -- no real money moves, no real fund units are
    allotted, nothing is sent to any AMC, bank, or transfer agent. Purely
    records a row in demo_holdings against the fund's current displayed
    NAV so the demo portfolio can show a realistic position."""
    data = request.get_json(silent=True) or {}
    fund, amount, error = validate_buy_request(data)
    if error:
        return error

    user_id = session["user_id"]
    quote = build_quote(fund, amount, user_id)

    try:
        with get_db_connection() as conn:
            row = execute(
                conn,
                """INSERT INTO demo_holdings
                   (user_id, fund_id, units, invested_amount, buy_nav, currency, status)
                   VALUES (%s, %s, %s, %s, %s, %s, 'completed')
                   RETURNING holding_id""",
                (user_id, fund["fund_id"], quote["units"], amount,
                 fund["nav"], fund.get("nav_currency") or "USD"),
            )
    except DemoDbError as exc:
        return jsonify({"success": False, "error": str(exc)}), 503

    quote["holding_id"] = row["holding_id"]
    return jsonify({
        "success": True,
        "message": "Payment notification sent",
        "order": quote,
    })


# --- Lead generation --------------------------------------------------------

@api_bp.route("/leads", methods=["POST"])
def create_lead():
    """Forwards a "Talk to an Expert" form submission to mf-engine-v2's
    lead_capture endpoint. GiftCityFunds is UI-only here -- no login
    required, and nothing is stored in this app's own database."""
    data = request.get_json(silent=True) or {}
    fields, error = validate_lead(data)
    if error:
        return jsonify({"success": False, "error": error}), 400

    try:
        result = submit_lead(
            fields["name"], fields["phone"], fields["email"], fields["message"], fields["page_path"]
        )
    except MfEngineError as exc:
        return _api_error(exc)

    return jsonify({"success": True, "lead": result.get("data", result)})


# --- Bulk export -----------------------------------------------------------

def _export_rows() -> List[Dict[str, Any]]:
    raw_funds = fetch_funds()
    funds = [adapters.fund_summary(f) for f in raw_funds]
    return sorted(funds, key=lambda f: (f.get("fund_name") or ""))


@api_bp.route("/export/csv")
def export_csv():
    """Exports the full dataset as a downloadable CSV."""
    try:
        funds = _export_rows()
    except MfEngineError as exc:
        return _api_error(exc)

    if not funds:
        return "No data", 404

    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=list(funds[0].keys()))
    writer.writeheader()
    writer.writerows(funds)

    output.seek(0)
    return Response(
        output.getvalue(),
        mimetype="text/csv",
        headers={"Content-Disposition": "attachment;filename=gift_city_funds_intelligence.csv"}
    )


@api_bp.route("/export/json")
def export_json():
    """Exports the complete dataset as downloadable JSON."""
    try:
        funds = _export_rows()
    except MfEngineError as exc:
        return _api_error(exc)

    return Response(
        json.dumps(funds, indent=2),
        mimetype="application/json",
        headers={"Content-Disposition": "attachment;filename=gift_city_funds_intelligence.json"}
    )
