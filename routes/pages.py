"""
routes/pages.py
Server-rendered HTML pages: the dashboard, the outbound/inbound fund
listing pages, and each fund's own detail page. The JSON API those pages
call into lives in routes/api.py instead.

DATA SOURCE CHANGE: these routes no longer open a SQLite connection. Fund
data comes from the shared mf-engine-v2 API via services/mf_engine.py, the
same source routes/api.py uses, so GIFT360 and Zinni serve identical numbers.

The demo portfolio page is kept, gated behind the demo login as before --
only its storage moved from SQLite to Postgres (services/demo_db.py), since
SQLite can't work on Vercel.
"""

from datetime import datetime
from typing import Optional

from flask import Blueprint, Response, redirect, render_template, url_for

from content.events import EVENTS
from content.faqs import FAQ_SOURCE_ATTRIBUTION, INBOUND_FAQS, OUTBOUND_FAQS
from content.insights import ARTICLES, CATEGORIES, get_article, related_articles
from routes.auth import login_required
from services import adapters, verified
from services.funds import slugify
from services.mf_engine import MfEngineError, fetch_funds

pages_bp = Blueprint("pages", __name__)


def _funds_by_flow(flow_type: str):
    """Returns funds for one capital-flow direction, in the frontend's
    expected field shape. On an upstream failure the page still renders --
    with an empty list and a flag the template can use to show a notice --
    rather than 500ing the whole page."""
    try:
        raw = fetch_funds()
    except MfEngineError:
        return [], True
    funds = [adapters.fund_summary(f) for f in raw if f.get("fund_flow_type") == flow_type]
    funds.sort(key=lambda f: (f.get("fund_name") or ""))
    return funds, False


@pages_bp.route("/")
def index():
    """Renders the main GIFT360 Dashboard UI."""
    return render_template("index.html")


@pages_bp.route("/market-intelligence")
def market_intelligence():
    """Fund categories, top asset managers, registration timeline and NAV leaderboard (the charts read /api/stats)."""
    return render_template("market_intelligence.html")


@pages_bp.route("/knowledge-hub")
def knowledge_hub():
    """GIFT City IFSC regulatory 101: the FAQ accordion."""
    return render_template("knowledge_hub.html")


@pages_bp.route("/gift-city-outbound")
def gift_city_outbound():
    """Dedicated page for outbound GIFT City funds (India/GIFT-domiciled
    capital investing abroad), with FAQ content specific to outbound
    investing (churn tax, lock-ins, AIF/PMS/Retail structure differences)."""
    funds, data_unavailable = _funds_by_flow("outbound")
    return render_template(
        "flow_page.html",
        flow_type="outbound",
        page_title="GIFT City Outbound Funds",
        page_subtitle="India/GIFT-domiciled capital investing abroad — AIFs, PMS, and retail fund strategies for global investing.",
        funds=funds,
        verified_info=verified.info(),
        data_unavailable=data_unavailable,
        faqs=OUTBOUND_FAQS,
        faq_source=FAQ_SOURCE_ATTRIBUTION,
        other_flow_url="/gift-city-inbound",
        other_flow_label="Inbound Funds",
    )


@pages_bp.route("/gift-city-inbound")
def gift_city_inbound():
    """Dedicated page for inbound GIFT City funds (foreign/NRI capital
    investing into India via GIFT), with FAQ content specific to inbound
    investing (K1 compliance, IFSCA tax benefits, investor eligibility)."""
    funds, data_unavailable = _funds_by_flow("inbound")
    return render_template(
        "flow_page.html",
        flow_type="inbound",
        page_title="GIFT City Inbound Funds",
        page_subtitle="Foreign and NRI capital investing into India through GIFT City IFSC — fund houses, strategies, and tax structure.",
        funds=funds,
        verified_info=verified.info(),
        data_unavailable=data_unavailable,
        faqs=INBOUND_FAQS,
        faq_source=FAQ_SOURCE_ATTRIBUTION,
        other_flow_url="/gift-city-outbound",
        other_flow_label="Outbound Funds",
    )


@pages_bp.route("/portfolio")
@login_required
def portfolio():
    """The logged-in demo user's simulated portfolio page. Data comes from
    /api/portfolio (routes/api.py); this route only renders the shell."""
    return render_template("portfolio.html")


@pages_bp.route("/fund/<int:fund_id>")
@pages_bp.route("/fund/<int:fund_id>/<slug>")
def fund_detail_page(fund_id: int, slug: Optional[str] = None):
    """Full standalone page for a single fund -- gives every fund its own
    shareable URL, named after the fund rather than just its numeric id. A
    bare /fund/<id> (or a stale/incorrect slug) 301-redirects to the
    canonical named URL so old links keep working.

    Looked up from the cached fund list rather than a per-fund API call:
    this route only needs the name and AMC for the page shell, and the
    detail page's own JavaScript fetches the full record from
    /api/fund/<id> anyway."""
    try:
        raw = fetch_funds()
    except MfEngineError:
        return render_template("fund_not_found.html"), 503

    fund = next((f for f in raw if f.get("id") == fund_id), None)
    if not fund:
        return render_template("fund_not_found.html"), 404

    correct_slug = slugify(fund["fund_name"])
    if slug != correct_slug:
        return redirect(
            url_for("pages.fund_detail_page", fund_id=fund_id, slug=correct_slug), code=301
        )

    return render_template(
        "fund_detail.html",
        fund_id=fund_id,
        fund_name=fund["fund_name"],
        amc_name=fund.get("amc_name") or (fund.get("amc") or {}).get("name"),
    )


@pages_bp.route("/events")
def events_index():
    """Lists GIFT City AMC events (webinars, sessions) MFAPIs organizes.
    Registration for each event happens on its own registration page
    (Luma, etc.), linked from here and from each event's own page.

    Split into Live (today or upcoming) and Past (already happened) --
    computed from each event's date_iso against today's date, not
    hand-maintained, so an event moves itself into Past the day after it
    happens without anyone needing to edit content/events.py again."""
    today = datetime.now().date()
    live_events, past_events = [], []
    for e in EVENTS:
        event_date = datetime.strptime(e["date_iso"], "%Y-%m-%d").date()
        (live_events if event_date >= today else past_events).append(e)
    live_events.sort(key=lambda e: e["date_iso"])
    past_events.sort(key=lambda e: e["date_iso"], reverse=True)
    # Land visitors on whichever tab actually has something to show --
    # defaulting to "Live" when there are none yet would just greet them
    # with an empty state instead of the past sessions that do exist.
    default_tab = "live" if live_events else "past"
    return render_template(
        "events.html",
        events=EVENTS,
        live_events=live_events,
        past_events=past_events,
        default_tab=default_tab,
    )


@pages_bp.route("/events/<slug>")
def event_detail(slug: str):
    """A single event's own shareable page -- full details plus the
    Register link, so a "Share" link from the listing lands someone
    directly on this event rather than the general listing."""
    event = next((e for e in EVENTS if e["slug"] == slug), None)
    if not event:
        return redirect(url_for("pages.events_index"))
    return render_template("event_detail.html", event=event)


@pages_bp.route("/insights")
def insights_index():
    """Listing page for GIFT360's in-house editorial section -- explainers
    and analysis on GIFT City IFSC investing, written to give readers a
    plain-English reference for the concepts the rest of the dashboard
    assumes they already know."""
    articles = sorted(ARTICLES, key=lambda a: a["published"], reverse=True)
    return render_template(
        "insights.html",
        articles=articles,
        featured=articles[0],
        categories=CATEGORIES,
    )


@pages_bp.route("/insights/<slug>")
def insight_detail(slug: str):
    """Single article page. An unknown/stale slug redirects to the
    Insights index rather than dead-ending the reader on a 404."""
    article = get_article(slug)
    if not article:
        return redirect(url_for("pages.insights_index"))
    published_display = datetime.strptime(article["published"], "%Y-%m-%d").strftime("%d %b %Y")
    return render_template(
        "insight_detail.html",
        article=article,
        published_display=published_display,
        related=related_articles(slug),
    )


@pages_bp.route("/robots.txt")
def robots_txt():
    body = "User-agent: *\nAllow: /\nDisallow: /login\nDisallow: /signup\nDisallow: /portfolio\n" \
           f"Sitemap: {url_for('pages.sitemap_xml', _external=True)}\n"
    return Response(body, mimetype="text/plain")


@pages_bp.route("/sitemap.xml")
def sitemap_xml():
    """Static routes plus every Insights article -- generated from
    content/insights.py rather than a hand-maintained URL list, so a new
    article is included automatically the day it's added."""
    static_urls = [
        (url_for("pages.index", _external=True), "1.0", "daily"),
        (url_for("pages.gift_city_outbound", _external=True), "0.9", "daily"),
        (url_for("pages.gift_city_inbound", _external=True), "0.9", "daily"),
        (url_for("pages.insights_index", _external=True), "0.9", "daily"),
        (url_for("pages.events_index", _external=True), "0.7", "weekly"),
        (url_for("pages.market_intelligence", _external=True), "0.7", "daily"),
        (url_for("pages.knowledge_hub", _external=True), "0.6", "monthly"),
    ]
    article_urls = [
        (url_for("pages.insight_detail", slug=a["slug"], _external=True), "0.7", "monthly")
        for a in ARTICLES
    ]
    event_urls = [
        (url_for("pages.event_detail", slug=e["slug"], _external=True), "0.6", "weekly")
        for e in EVENTS
    ]

    entries = "".join(
        f"<url><loc>{loc}</loc><changefreq>{freq}</changefreq><priority>{prio}</priority></url>"
        for loc, prio, freq in static_urls + article_urls + event_urls
    )
    xml = f'<?xml version="1.0" encoding="UTF-8"?>' \
          f'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{entries}</urlset>'
    return Response(xml, mimetype="application/xml")
