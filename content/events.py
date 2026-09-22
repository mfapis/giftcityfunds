"""
content/events.py
GIFT City-related events GIFT360 organizes or co-hosts. Registration for
each event happens on its actual registration page (Luma, for now) --
listed here, not reproduced as a form on this site.
"""

EVENTS = [
    {
        "slug": "gift-city-alternative-investments-ppfas-webinar",
        "title": "Understanding Alternative Investments & Opportunities in GIFT City",
        "badge": "Webinar",
        "cover": "img/Events/PPFAS_Webinar.jpeg",
        "organizer": "MFAPIs",
        "speakers": "Akshay Falgunia (Fund Manager, PPFAS GIFT Fund) and Hema Thakkar (Head, Business Development -- Alternatives)",
        "date_display": "Fri, 18 Sep 2026",
        # ISO date the event actually falls on, used to split events.py's
        # listing into Live vs Past -- keep this in sync with date_display
        # whenever the event's date changes. Time-of-day isn't tracked, so
        # an event is treated as "past" starting the day after it happens.
        "date_iso": "2026-09-18",
        "time_display": "4:00 -- 5:00 PM IST",
        "format_display": "Online",
        "card_description": "PPFAS GIFT Fund's Akshay Falgunia and Hema Thakkar unpack the alternative investments landscape in GIFT City -- strategy, portfolio construction, and where the space is headed.",
        "detail_description": "Akshay Falgunia (Fund Manager, PPFAS GIFT Fund) walks through the fund's own investment approach, portfolio strategy, and current market opportunities. Hema Thakkar (Head of Business Development, Alternatives) covers the broader alternatives landscape and the opportunities it opens up for investors. Together the session works through PPFAS GIFT Fund's operations, the alternative investment landscape inside GIFT City, market and portfolio-construction perspectives, and where alternatives in India are headed next -- an opportunity to hear directly from professionals working in this space.",
        "agenda": [
            "PPFAS GIFT Fund: investment approach, portfolio strategy, market opportunities",
            "The broader alternatives landscape in GIFT City",
            "Market perspectives and portfolio construction insights",
            "Where alternatives in India are headed next",
        ],
        "register_url": "https://luma.com/g9yh8zd4",
        # Powers the embedded Luma checkout button (opens inline, no
        # navigating away) -- confirmed against this event's own Luma
        # dashboard, not a docs example. Falls back to register_url as a
        # plain link on any event that doesn't set this.
        "luma_event_id": "evt-McUEYwTwFcsAm44",
    },
]
