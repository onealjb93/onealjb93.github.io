"""Daily market-data updater for the finance page (onealjb93.github.io).

What it does
------------
Writes finance-data.json, which finance.html fetches and renders. One row per
ticker, with a price and a set of fundamentals.

Sources (all free; only Alpha Vantage needs a key, and only from the env):
- Price: Alpha Vantage GLOBAL_QUOTE, 19 calls/day, 12 s apart (free tier is
  5/min and 25/day). "05. price" is the latest close; "07. latest trading
  day" is its as-of date. The workflow runs at 22:00 UTC, after the 4 p.m. ET
  close, so that price is the latest close.
- Market cap: price x shares outstanding from the latest SEC EDGAR filing
  (companyfacts, no key). The ticker->CIK map is committed as cik_map.json
  because the live SEC file 403s automated access from cloud IPs; the live
  fetch only fills gaps for tickers missing from the file. Cross-checked
  against OVERVIEW MarketCapitalization where an OVERVIEW call was made.
- Fundamentals (PEG, growth, debt, ROE, margin): SEC EDGAR companyfacts
  (us-gaap tags first, ifrs-full for foreign filers), refreshed weekly on
  rotation; Alpha Vantage OVERVIEW (max 4 calls/day, only for tickers whose
  fundamentals are > 7 days stale) for PEGRatio, AnalystTargetPrice and
  cross-checks. 19 quotes + at most 4 OVERVIEWs = 23 calls/day max.
- Fundamentals fallback (added 2026-11-16, after the audit found ROE,
  margin and market cap null for all 19 tickers since the file was built):
  when EDGAR yields no fundamentals for a due ticker, OVERVIEW becomes
  that ticker's fundamentals source of record (ReturnOnEquityTTM,
  ProfitMargin, MarketCapitalization), the record is labelled
  "Alpha Vantage OVERVIEW", and its refresh date is set so the weekly
  rotation moves on. The rotation therefore completes even if EDGAR
  stays blocked: at most 4 tickers per run, all 19 inside five weekday
  runs.
- First-real-run fix (2026-11-16): the fallback above shipped in the
  morning and its first real run that afternoon wrote NOTHING — every
  fundamentals field stayed null and the data carried no trace of why.
  Diagnosis found two independent silent failures:
  (1) EDGAR: SEC's gate rejects the User-Agent token
      "onealjb93.github.io" — a bare domain is not SEC's declared format,
      which is a NAME plus a contact email ("Sample Company Name
      AdminContact@example.com"). Reproduced from a datacenter IP: the
      domain-token UA gets SEC's 403 "Undeclared Automated Tool" page,
      while a name+email UA gets the full companyfacts JSON from the
      same IP in the same minute. The User-Agent below is now a name
      plus the site's contact email, exactly SEC's declared format.
  (2) OVERVIEW: Alpha Vantage's daily-quota response is an
      "Information" payload, NOT the legacy "Note" the old code checked
      for. The old code raised a generic error on it, fetch_overview
      swallowed that as an ordinary per-ticker failure, and the run
      finished green with nothing recorded. "Information" (and "Error
      Message") payloads are now classified explicitly (see below).
  So the failure can never be silent again, every run now writes a
  top-level "fundamentals_status" block into finance-data.json — per
  source: attempted / ok / blocked / filled / throttled counts plus the
  first failure detail verbatim — and every due ticker carries a
  "fundamentals_note" saying what happened to its refresh. A green run
  whose fundamentals failed is now visible in the data itself.
- Foreign-filer / dead-tag fix (2026-11-16): five tickers still came
  back partial after the fix above, each for a diagnosed reason —
  (a) annual/quarterly selection accepted only 10-K/10-Q forms, so
      20-F filers (TSM, NBIS) read as permanently empty; 20-F/40-F
      and 6-K forms now count, with a guard that a quarterly series
      ending at or before the latest annual is a stale fragment
      (TSM's only 6-K rows are half-year figures from 2020-21), not
      a current quarter;
  (b) tag/unit selection took the first series with any data, so a
      retired tag or unit was read forever: AAOI/AMD revenue (the
      Revenues tag died in 2017-18), NBIS's legacy RUB unit (ended
      2023), and — quietly worse — MU's and WM's revenue annuals,
      COST's and WMT's EPS units, and JPM's revenue quarters were
      stale fragments too, mixing periods years apart into margins,
      growth rates and PEGs that were live on the page. A series
      whose latest end is > ~18 months behind a sibling's is now
      treated as retired; preference order otherwise stands (a
      bank's ASC 606 subset is not its total revenue);
  (c) share counts now come dei-first (the cover-page count — the
      scoreboard block's order), which also repairs WMT's market
      cap, stale since its 2024 split; the ifrs IssuedCapital
      fallback is gone — it is share capital in money, not a count,
      and reading it as one put TSM's "market cap" at $103 trillion;
  (d) a non-USD reporter (TSM) gets no market cap and no PEG from
      these filings: its share count and EPS are ordinary-share TWD
      figures while the price is the USD ADS price, and a figure
      multiplied across that mismatch would be wrong, not
      approximate. Its note says so, as does SPCX's: two 10-Qs
      since its June 2026 IPO and no annual report yet, so no
      trailing twelve months exists in its filings to compute.
  PEG is also no longer computed when earnings or growth are
  negative — the ratio is undefined there, and a negative "PEG"
  is a nonsense number, not a bearish signal.
- Momentum: 3-month % price return computed from Stooq daily closes (free,
  no key): (latest close / close 63 trading days earlier - 1) x 100.
  NOTE: Stooq now serves a JavaScript browser-verification page to
  automated clients, so this often yields no rows; the run logs that
  plainly instead of failing silently. The finance page no longer depends
  on this field — it derives 3-month momentum in-page from
  finance-history.json (Yahoo weekly closes).
- Institutional ownership: there is NO free reliable source for this (it lives
  in 13F filings, not in EDGAR companyfacts or OVERVIEW). The value is carried
  forward from the existing JSON as the author's estimate, and the page's
  disclaimer says so. It is never presented as live data.

Honesty rules (do not weaken them)
-----------------------------------
- The API key comes ONLY from os.environ.get("API_KEY"). There is no key in
  this file, no fallback price table, and no fabricated formula.
- A missing value is null, never a guess and never zero. A failed quote, a
  missing EDGAR tag, a short filing history (e.g. a recent IPO) or a Stooq
  miss all come out as null, and the page shows a dash.
- Alpha Vantage throttling comes in two payload shapes: a "Note" (the
  per-minute limit) and an "Information" message (the 25/day quota).
  Both are detected. If either arrives during the PRICE phase, the run
  stops immediately with a non-zero exit and writes nothing (a partial
  price file would be misleading). If it arrives during the
  FUNDAMENTALS phase, the prices are already complete: the run records
  the throttle in fundamentals_status, notes it on the affected
  tickers, makes no further OVERVIEW calls that run, and still writes —
  carried-forward fundamentals next to an explicit failure record are
  honest; silently null fundamentals were not.
- Call budget, enforced by a counter in code: 19 GLOBAL_QUOTE calls +
  at most 4 OVERVIEW calls = 23 planned, hard cap 24, under the free
  tier's 25/day. The counter stops OVERVIEW attempts (never quotes
  mid-file) before the cap is crossed.
- A missing or unreachable ticker->CIK map never kills a run: prices are
  still fetched and missing fundamentals come out as null.
- Nothing is written until every ticker has been processed.
"""

import json
import os
import sys
import time
from datetime import date

import requests

CORE_TICKERS = [
    "GOOGL", "ASST", "CIFR", "SPCX", "NBIS", "IREN", "AAOI",
    "NVDA", "AMD", "PLTR", "MU", "TSLA", "MSTR", "TSM",
    "LLY", "WM", "COST", "JPM", "WMT",
]

# The scoreboard's grading set lives in scoreboard-stocks.json:
# the workflow's sync step merges the owner's filed add/remove
# requests into it, and everything graded — the scoreboard data,
# the fundamentals rotation, grades-history — follows the file.
# A missing or malformed file falls back to the core set above,
# so a bad edit can never empty the scoreboard.
SCOREBOARD_FILE = "scoreboard-stocks.json"


def load_scoreboard_tickers():
    import re
    paths = [os.path.join(os.path.dirname(os.path.abspath(__file__)),
                          SCOREBOARD_FILE), SCOREBOARD_FILE]
    for path in paths:
        try:
            with open(path) as fh:
                doc = json.load(fh)
        except (OSError, ValueError):
            continue
        raw = doc.get("tickers") if isinstance(doc, dict) else doc
        if not isinstance(raw, list):
            continue
        out = []
        for t in raw:
            if (isinstance(t, str)
                    and re.fullmatch(r"[A-Z][A-Z0-9.\-]{0,9}", t)
                    and t not in out):
                out.append(t)
        if out:
            return out
    return list(CORE_TICKERS)


TICKERS = load_scoreboard_tickers()

DATA_FILE = "finance-data.json"
CIK_MAP_FILE = "cik_map.json"
OVERVIEW_MAX_PER_RUN = 4
FUNDAMENTALS_STALE_DAYS = 7

# Annual dividends ($/share on the $100 stated amount) for the two income
# preferreds behind the member card's yield equation on finance.html.
# Issuer-declared rates: STRC (Strategy, variable rate, reset monthly --
# 12.00% in effect since Jul 1, 2026; re-check against new 8-Ks / press
# releases around each month-end) and SATS (Strive Series A Perpetual
# SATS Preferred, FIXED at 15.00%, cumulative). Only the rates live
# here; prices are fetched from Yahoo on every run (see
# build_preferreds_block), so the page's yields stay current.
PREFERRED_DIVIDENDS = {"STRC": 12.00, "SATS": 15.00}
PREFERRED_TICKERS = ("STRC", "SATS")

EDGAR_HEADERS = {
    # SEC's declared format for automated access: a NAME + a real contact
    # email ("Sample Company Name AdminContact@example.com"). A bare
    # domain as the name token ("onealjb93.github.io ...") is rejected by
    # SEC's gate with the 403 "Undeclared Automated Tool" page — verified
    # 2026-11-16 from a datacenter IP, where this name+email form
    # returned the full companyfacts JSON in the same minute.
    "User-Agent": "Johnny O'Neal johnny-website@muse.ai",
    "Accept": "application/json",
    "Accept-Encoding": "gzip, deflate",
}

# ---------------------------------------------------------------- helpers ---

def log(msg):
    print(msg, flush=True)


def parse_float(value):
    try:
        if value is None:
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def money_str(mcap_billions):
    """Format a market cap given in $ billions: $2.18T / $850.0M / $2.70B."""
    if mcap_billions is None:
        return None
    if mcap_billions >= 1000:
        return "$%.2fT" % (mcap_billions / 1000.0)
    if mcap_billions >= 1:
        return "$%.2fB" % mcap_billions
    return "$%.1fM" % (mcap_billions * 1000.0)


# ------------------------------------------------------- Alpha Vantage ---

class RateLimited(Exception):
    """Alpha Vantage per-minute throttle (the "Note" payload)."""


class DailyQuota(RateLimited):
    """Alpha Vantage daily quota / usage block (the "Information" payload).

    Subclasses RateLimited so existing throttle handling catches it;
    callers that need to tell the two apart check isinstance.
    """


# Free tier is 25 calls/day. A run plans 19 quotes + at most 4 OVERVIEWs
# = 23; the counter hard-stops at 24 so the run itself can never cross
# the limit even if the plan changes.
AV_CALL_BUDGET = 24
_av_call_count = [0]

# Why the most recent OVERVIEW call failed (set by fetch_overview), so the
# run can record the reason in finance-data.json, not just in the log.
_last_overview_error = [None]


def alpha_vantage(api_key, function, symbol):
    """One Alpha Vantage call, classified.

    Raises RateLimited on a throttling "Note", DailyQuota on an
    "Information" quota/usage payload or when the local call budget is
    exhausted, and ValueError on an "Error Message" payload. (The old
    code treated "Information" as a generic error, which fetch_overview
    then swallowed — the silent failure behind the 2026-11-16 run that
    wrote no fundamentals.)
    """
    _av_call_count[0] += 1
    if _av_call_count[0] > AV_CALL_BUDGET:
        raise DailyQuota(
            "local call-budget guard: %d Alpha Vantage calls already made "
            "this run (budget %d of the free tier's 25/day); refusing "
            "another (%s %s)" % (_av_call_count[0] - 1, AV_CALL_BUDGET,
                                  function, symbol)
        )
    url = "https://www.alphavantage.co/query"
    resp = requests.get(
        url,
        params={"function": function, "symbol": symbol, "apikey": api_key},
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()
    if isinstance(data, dict) and "Note" in data:
        raise RateLimited(
            "Alpha Vantage rate limit (%s %s): %s" % (function, symbol, data["Note"])
        )
    if isinstance(data, dict) and "Information" in data:
        raise DailyQuota(
            "Alpha Vantage daily quota (%s %s): %s"
            % (function, symbol, data["Information"])
        )
    if isinstance(data, dict) and "Error Message" in data:
        raise ValueError(
            "Alpha Vantage error (%s %s): %s"
            % (function, symbol, data["Error Message"])
        )
    return data


def fetch_quote(api_key, symbol):
    """Returns (price, as_of_date) or (None, None)."""
    try:
        data = alpha_vantage(api_key, "GLOBAL_QUOTE", symbol)
    except RateLimited:
        raise
    except Exception as exc:  # network/API failure: no price, not a guess
        log("  quote failed for %s: %s" % (symbol, exc))
        return None, None
    quote = data.get("Global Quote") or {}
    price = parse_float(quote.get("05. price"))
    as_of = quote.get("07. latest trading day") or None
    if price is None:
        log("  no quote in GLOBAL_QUOTE response for %s" % symbol)
    return price, as_of


def fetch_overview(api_key, symbol):
    """Returns the OVERVIEW dict, or None on failure. Throttles raise.

    Ordinary failures also stash their reason in _last_overview_error so
    the run can record it in finance-data.json (fundamentals_status),
    not just in the Actions log.
    """
    try:
        data = alpha_vantage(api_key, "OVERVIEW", symbol)
    except RateLimited:
        raise
    except Exception as exc:
        _last_overview_error[0] = str(exc)
        log("  OVERVIEW failed for %s: %s" % (symbol, exc))
        return None
    if not data or not data.get("Symbol"):
        _last_overview_error[0] = "empty OVERVIEW response (no Symbol field)"
        log("  empty OVERVIEW response for %s" % symbol)
        return None
    return data


# ---------------------------------------------------------------- EDGAR ---

def fetch_cik_map():
    resp = requests.get(
        "https://www.sec.gov/files/company_tickers.json",
        headers=EDGAR_HEADERS,
        timeout=30,
    )
    resp.raise_for_status()
    by_ticker = {}
    for entry in resp.json().values():
        by_ticker[entry["ticker"]] = "%010d" % entry["cik_str"]
    return by_ticker


def load_cik_map():
    """Ticker -> 10-digit CIK from the committed cik_map.json.

    The live SEC ticker->CIK file 403s automated access from cloud IPs, so
    the committed map is the primary source and the live fetch only fills
    gaps. Values are stored as 10-digit zero-padded strings; they are
    normalised here so an integer in the file still works.
    """
    with open(CIK_MAP_FILE) as fh:
        raw = json.load(fh)
    by_ticker = {}
    for ticker, cik in raw.items():
        by_ticker[ticker] = "%010d" % int(cik)
    return by_ticker


class EdgarBlocked(Exception):
    """SEC answered with its 'Undeclared Automated Tool' block page."""


def fetch_companyfacts(cik):
    resp = requests.get(
        "https://data.sec.gov/api/xbrl/companyfacts/CIK%s.json" % cik,
        headers=EDGAR_HEADERS,
        timeout=60,
    )
    if resp.status_code == 403 and "Undeclared Automated Tool" in resp.text:
        raise EdgarBlocked(
            "HTTP 403: SEC 'Undeclared Automated Tool' block page"
        )
    resp.raise_for_status()
    return resp.json()


def fact_entries(facts, tag_candidates):
    """All (end, value, form) entries for the best candidate tag.

    tag_candidates is a list of (taxonomy, tag) pairs in preference
    order — us-gaap first, ifrs-full as the fallback for foreign
    filers, and within us-gaap the total-revenue tag before its
    ASC 606 subset (for a bank the subset is not total revenue, so
    order matters and is kept). Preference order decides UNLESS an
    earlier candidate's series is dead — its latest period end more
    than ~18 months older than a later candidate's — because filers
    do retire tags: AAOI and AMD stopped tagging revenue as Revenues
    in 2017-18 and file it as RevenueFromContract... today, so a
    first-tag-with-anything rule reads 2018 figures forever (it was
    even publishing a 2018 revenue-growth rate for AAOI). The same
    staleness rule picks the unit within a tag: NBIS (ex-Yandex)
    still carries a legacy RUB series that ended in 2023 alongside
    its live USD one.
    """
    entries, _unit = fact_entries_with_unit(facts, tag_candidates)
    return entries


# A series whose latest period end is this far behind a sibling
# series' is a retired tag/unit, not a live alternative.
STALE_DAYS = 550


def _series_key(entries):
    return entries[-1][0] if entries else ""


def _fresher_by_margin(a_end, b_end):
    """True if ISO date a_end is more than STALE_DAYS after b_end."""
    if not a_end or not b_end:
        return False
    from datetime import date as _date
    return (_date.fromisoformat(a_end)
            - _date.fromisoformat(b_end)).days > STALE_DAYS


def fact_entries_with_unit(facts, tag_candidates):
    """fact_entries plus the winning unit name (or None)."""
    best = None  # (entries, unit)
    best_end = ""
    for taxonomy, tag in tag_candidates:
        try:
            units = facts["facts"][taxonomy][tag]["units"]
        except KeyError:
            continue
        tag_best = None  # (entries, unit)
        tag_best_end = ""
        for unit, unit_values in units.items():
            entries = [
                (e["end"], e["val"], e.get("form", ""))
                for e in unit_values
                if "end" in e and "val" in e
            ]
            if not entries:
                continue
            entries = sorted(entries)
            if tag_best is None or _fresher_by_margin(
                    _series_key(entries), tag_best_end):
                tag_best = (entries, unit)
                tag_best_end = _series_key(entries)
        if tag_best is not None and (
                best is None
                or _fresher_by_margin(tag_best_end, best_end)):
            best = tag_best
            best_end = tag_best_end
    if best is None:
        return [], None
    return best


# Filing forms that carry annual / quarterly financial statements.
# Foreign private issuers file the same statements as 20-F (annual)
# and 6-K (interim) instead of 10-K / 10-Q; a 10-K-only filter reads
# their fundamentals as permanently empty (TSM, NBIS).
ANNUAL_FORMS = {"10-K", "10-K/A", "20-F", "20-F/A", "40-F", "40-F/A"}
QUARTERLY_FORMS = {"10-Q", "10-Q/A", "6-K"}


def latest_value(entries):
    """Most recent value by period end (instant tags: shares, equity, debt)."""
    if not entries:
        return None, None
    end, val, form = entries[-1]
    return parse_float(val), end


def latest_quarterly(entries):
    """Most recent quarterly-form value, or None.

    A quarterly series that ends at or before the latest annual in
    the same entries is a stale fragment, not a current quarter —
    TSM's only 6-K rows are two half-year figures from 2020-21, and
    reading them as "the latest quarter" would publish years-old
    growth and corrupt the TTM. Such a series reads as no quarter.
    """
    quarters = [e for e in entries if e[2] in QUARTERLY_FORMS]
    if not quarters:
        return None, None, None
    annual_ends = [e[0] for e in entries if e[2] in ANNUAL_FORMS]
    if annual_ends and quarters[-1][0] <= max(annual_ends):
        return None, None, None
    end, val, _ = quarters[-1]
    prior = [e for e in quarters if e[0] == _shift_year(end)]
    prior_val = parse_float(prior[-1][1]) if prior else None
    return parse_float(val), prior_val, end


def latest_annual(entries):
    """Most recent annual value plus the prior year's, or None.

    The prior figure is the latest row with a strictly earlier end:
    companyfacts repeats each annual in later filings' comparatives,
    so the second-to-last row can be the same year restated rather
    than the year before it.
    """
    annuals = [e for e in entries if e[2] in ANNUAL_FORMS]
    if not annuals:
        return None, None, None
    end, val, _ = annuals[-1]
    prior_rows = [e for e in annuals if e[0] < end]
    prior_val = parse_float(prior_rows[-1][1]) if prior_rows else None
    return parse_float(val), prior_val, end


def _shift_year(date_str):
    """Same date one year earlier (YYYY-MM-DD)."""
    try:
        y, m, d = date_str.split("-")
        return "%04d-%s-%s" % (int(y) - 1, m, d)
    except (ValueError, AttributeError):
        return ""


def ttm_value(entries):
    """Trailing-twelve-months value for a flow tag (revenues, net income, EPS).

    Latest 10-K annual + latest 10-Q quarter - same quarter last year.
    Falls back to the latest annual figure when quarters are unavailable.
    Returns (ttm, fiscal_period_label) or (None, None).
    """
    annual, _prior_annual, annual_end = latest_annual(entries)
    quarter, quarter_prior, quarter_end = latest_quarterly(entries)
    if annual is not None and quarter is not None and quarter_prior is not None:
        return annual + quarter - quarter_prior, quarter_end
    if annual is not None:
        return annual, annual_end
    return None, None


# ---------------------------------------------------------------- Stooq ---

def fetch_stooq_history(symbol):
    """Daily closes from Stooq: list of (date, close), oldest first."""
    url = "https://stooq.com/q/d/l/?s=%s.us&i=d" % symbol.lower()
    try:
        resp = requests.get(url, timeout=30)
        resp.raise_for_status()
    except Exception as exc:
        log("  Stooq history failed for %s: %s" % (symbol, exc))
        return []
    if not resp.text.startswith("Date,"):
        # Stooq now answers automated clients with a JavaScript
        # browser-verification page (HTTP 200, HTML body). Say so plainly
        # instead of parsing it into zero rows and staying silent.
        log("  Stooq served a non-CSV response for %s (browser-verification "
            "page); momentum unavailable from Stooq this run" % symbol)
        return []
    rows = []
    for line in resp.text.splitlines()[1:]:  # skip header
        parts = line.split(",")
        if len(parts) < 5:
            continue
        try:
            close = float(parts[4])
        except ValueError:
            continue
        rows.append((parts[0], close))
    rows.sort()
    return rows


def momentum_3m(history):
    """3-month % return: (latest close / close 63 trading days earlier - 1) x 100."""
    if len(history) < 64:
        return None, None
    latest_date, latest_close = history[-1]
    _old_date, old_close = history[-64]
    if not old_close:
        return None, None
    return round((latest_close / old_close - 1.0) * 100.0, 2), latest_date


# ------------------------------------------------------------- main run ---



# =====================================================================
# Scoreboard block (added 2026-11-16): raw inputs for the Greenblatt /
# Graham / Lynch scoreboard legs, computed from the same companyfacts
# payload the fundamentals refresh already fetched — no new EDGAR
# calls, no new Alpha Vantage calls. One keyless Yahoo split-events
# call per refreshed ticker.
#
# Honesty rules (same as the rest of this updater):
# - A field the filings don't yield is None, never a guess.
# - Every block carries source + as_of stamps.
# - Reporting currency is recorded; tests that would cross currencies
#   (a USD price against TWD per-share figures) are gated on the page.
# - Per-share earnings history is SPLIT-ADJUSTED and rebuilt from each
#   period's ORIGINAL filing: later filings carry split-restated
#   comparatives, and old 10-Ks carry a quarterly-data note whose Q4
#   figure is also tagged as a full year. A filing's figures already
#   reflect every split on or before its filing date (Walmart's
#   original FY2024 10-K, filed after its 3:1 split, reports the
#   post-split $1.91), so each original figure is divided only by the
#   splits that came after that filing. When split data can't be
#   fetched, the block is not refreshed at all — the previous block
#   stands with its own as_of, so no degraded block is ever built
#   (an unadjusted history would leave eps_cagr_pct null and the
#   page's growth-dependent legs dark).
# =====================================================================

import re

# Tag candidate lists: (taxonomy, tag) pairs, us-gaap preferred,
# ifrs-full fallback for foreign filers (same pattern as the updater).
EBIT_TAGS = [
    ("us-gaap", "OperatingIncomeLoss"),
    ("ifrs-full", "ProfitLossFromOperatingActivities"),
    ("ifrs-full", "OperatingProfitLoss"),
]
REVENUE_TAGS = [
    ("us-gaap", "Revenues"),
    ("us-gaap", "RevenueFromContractWithCustomerExcludingAssessedTax"),
    ("ifrs-full", "Revenue"),
]
NET_INCOME_TAGS = [
    ("us-gaap", "NetIncomeLoss"),
    ("ifrs-full", "ProfitLoss"),
]
EPS_TAGS = [
    ("us-gaap", "EarningsPerShareDiluted"),
    ("ifrs-full", "DilutedEarningsPerShare"),
    ("ifrs-full", "DilutedEarningsLossPerShare"),
]
EQUITY_TAGS = [
    ("us-gaap", "StockholdersEquity"),
    ("ifrs-full", "Equity"),
]
LT_DEBT_TAGS = [
    ("us-gaap", "LongTermDebt"),
    ("ifrs-full", "NonCurrentBorrowings"),
]
CUR_DEBT_TAGS = [
    ("us-gaap", "LongTermDebtCurrent"),
    ("us-gaap", "ShortTermBorrowings"),
    ("ifrs-full", "CurrentBorrowings"),
]
CASH_TAGS = [
    ("us-gaap", "CashAndCashEquivalentsAtCarryingValue"),
    ("ifrs-full", "CashAndCashEquivalents"),
]
CURRENT_ASSET_TAGS = [
    ("us-gaap", "AssetsCurrent"),
    ("ifrs-full", "CurrentAssets"),
]
CURRENT_LIAB_TAGS = [
    ("us-gaap", "LiabilitiesCurrent"),
    ("ifrs-full", "CurrentLiabilities"),
]
PPE_TAGS = [
    ("us-gaap", "PropertyPlantAndEquipmentNet"),
    ("ifrs-full", "PropertyPlantAndEquipment"),
]
INVENTORY_TAGS = [
    ("us-gaap", "InventoryNet"),
    ("ifrs-full", "Inventories"),
]
RECEIVABLE_TAGS = [
    ("us-gaap", "AccountsReceivableNetCurrent"),
    ("us-gaap", "ReceivablesNetCurrent"),
    ("ifrs-full", "TradeAndOtherCurrentReceivables"),
]
OCF_TAGS = [
    ("us-gaap", "NetCashProvidedByUsedInOperatingActivities"),
    ("ifrs-full", "CashFlowsFromUsedInOperatingActivities"),
]
CAPEX_TAGS = [
    ("us-gaap", "PaymentsToAcquirePropertyPlantAndEquipment"),
    ("ifrs-full", "PurchaseOfPropertyPlantAndEquipment"),
]
DIVIDENDS_PAID_TAGS = [
    ("us-gaap", "PaymentsOfDividendsCommonStock"),
    ("us-gaap", "PaymentsOfDividends"),
    ("ifrs-full", "DividendsPaidToEquityHoldersOfTheParent"),
    ("ifrs-full", "DividendsPaid"),
]
DPS_DECLARED_TAGS = [
    ("us-gaap", "CommonStockDividendsPerShareDeclared"),
]
SHARE_TAGS_BLOCK = [
    # dei cover-page count first: it is the current figure. (The us-gaap
    # CommonStockSharesOutstanding series stops being tagged by some
    # filers — Walmart's ends in 2012 — which is why the updater's own
    # share pull can come back stale; the block must not inherit that.)
    ("dei", "EntityCommonStockSharesOutstanding"),
    ("us-gaap", "CommonStockSharesOutstanding"),
    ("us-gaap", "WeightedAverageNumberOfDilutedSharesOutstanding"),
    ("ifrs-full", "IssuedCapital"),
]

ANNUAL_FORMS = {"10-K", "10-K/A", "20-F", "20-F/A", "40-F", "40-F/A"}
_FULL_YEAR_FRAME = re.compile(r"^CY\d{4}$")


def fact_rows(facts, tag_candidates, unit_preference=None):
    """Full companyfacts rows for the first tag that has data.

    Unlike fact_entries (which returns (end, val, form) tuples), this
    keeps fp / filed / frame / unit so annual series can be built
    accurately. Returns (rows, unit) or ([], None).
    """
    for taxonomy, tag in tag_candidates:
        try:
            units = facts["facts"][taxonomy][tag]["units"]
        except (KeyError, TypeError):
            continue
        unit_names = list(units.keys())
        if unit_preference:
            unit_names.sort(key=lambda u: (unit_preference.index(u)
                                           if u in unit_preference
                                           else len(unit_preference)))
        for unit in unit_names:
            rows = [e for e in units[unit]
                    if "end" in e and "val" in e]
            if rows:
                return rows, unit
    return [], None


def _full_year_frame(frame):
    return bool(frame) and bool(_FULL_YEAR_FRAME.match(frame))


def _pick_original(rows_at_end):
    """The annual figure from the ORIGINAL filing for one period end.

    companyfacts carries several rows per period end: the original
    10-K's figure, later filings' restated comparatives (including
    split-restated ones), and — in old 10-Ks — the unaudited
    quarterly-data note's Q4 figure, also tagged fp 'FY'. The original
    filing is the earliest `filed` at the end; within it a full-year
    frame wins, then the value repeated most often across all filings
    at that end (annual figures recur as comparatives; Q4-note figures
    rarely do), then the largest magnitude.
    Returns (val, filed).
    """
    from collections import Counter
    earliest = min(e.get("filed", "") for e in rows_at_end)
    group = [e for e in rows_at_end if e.get("filed", "") == earliest]
    fy = [e for e in group if _full_year_frame(e.get("frame"))]
    pool = fy if fy else group
    if len({e["val"] for e in pool}) == 1:
        return pool[0]["val"], earliest
    counts = Counter(e["val"] for e in rows_at_end)
    best = max(pool, key=lambda e: (counts[e["val"]], abs(e["val"])))
    return best["val"], earliest


def _annual_groups(rows):
    by_end = {}
    for e in rows:
        if e.get("fp") != "FY":
            continue
        form = e.get("form", "")
        if form and form not in ANNUAL_FORMS:
            continue
        by_end.setdefault(e["end"], []).append(e)
    return by_end


def _spacing_walk(series):
    """Drop any end less than 300 days before the next kept end —
    annual period ends are ~365 days apart, so a closer neighbour is
    a quarterly straggler, not a fiscal year."""
    from datetime import date as _date
    kept = []
    for end, val in reversed(series):
        if kept:
            if (_date.fromisoformat(kept[-1][0])
                    - _date.fromisoformat(end)).days < 300:
                continue
        kept.append((end, val))
    kept.reverse()
    return kept


def annual_series(rows):
    """Annual FLOW values (revenue, dividends paid, ...), oldest
    first: the original filing's figure at each period end."""
    by_end = _annual_groups(rows)
    series = []
    for end in sorted(by_end):
        val, _filed = _pick_original(by_end[end])
        series.append((end, val))
    return _spacing_walk(series)


def annual_series_instant(rows):
    """Annual INSTANT values (inventory, receivables — balance-sheet
    dates), oldest first. Balance-sheet figures aren't carried in the
    quarterly-data note, and a restatement is a correction, so at each
    end the latest-filed figure wins."""
    by_end = _annual_groups(rows)
    series = []
    for end in sorted(by_end):
        best = max(by_end[end],
                   key=lambda e: (e.get("filed", ""),
                                  1 if _full_year_frame(e.get("frame")) else 0))
        series.append((end, best["val"]))
    return _spacing_walk(series)


def annual_eps_series(rows, splits, adjusted):
    """Annual diluted EPS, split-adjusted, oldest first.

    A filing's per-share figures already reflect every split that
    occurred on or before its filing date (retroactive restatement is
    required when a split lands between period end and issuance —
    Walmart's original FY2024 10-K, filed after its 3:1 split, reports
    the post-split $1.91). So the original filing's figure is divided
    only by the splits that came AFTER that filing.
    Returns [(end, adjusted_val), ...].
    """
    by_end = _annual_groups(rows)
    series = []
    for end in sorted(by_end):
        val, filed = _pick_original(by_end[end])
        if adjusted:
            val = val / split_factor_after(filed, splits)
        series.append((end, val))
    return _spacing_walk(series)


def split_factor_after(end, splits):
    """Cumulative split factor for splits strictly after `end`.
    splits: [(date_iso, factor)] with factor = numerator/denominator."""
    factor = 1.0
    for split_date, split_factor in splits:
        if split_date > end:
            factor *= split_factor
    return factor


def _eps_rows_and_unit(facts):
    """Diluted EPS rows in the filer's own per-share unit.

    For IFRS filers the native presentation unit wins over the USD
    convenience translation (TSM's USD/shares figures are translated
    per ORDINARY share — unusable against the ADS price; the page
    gates price-crossing tests on the reported currency instead).
    For US filers, USD/shares.
    Returns (rows, unit) or ([], None).
    """
    for taxonomy, tag in EPS_TAGS:
        try:
            units = facts["facts"][taxonomy][tag]["units"]
        except (KeyError, TypeError):
            continue
        if not units:
            continue
        if taxonomy == "ifrs-full":
            non_usd = [u for u in units if not u.startswith("USD")]
            unit = non_usd[0] if non_usd else next(iter(units))
        elif "USD/shares" in units:
            unit = "USD/shares"
        else:
            unit = next(iter(units))
        rows = [e for e in units.get(unit, [])
                if "end" in e and "val" in e]
        if rows:
            return rows, unit
    return [], None


def build_scoreboard_block(facts, price, fallback_shares, mcap_billions,
                           splits, fact_entries, ttm_value, latest_value,
                           today):
    """Compute the scoreboard block for one ticker.

    facts: parsed companyfacts JSON. price: this run's price.
    fallback_shares / mcap_billions: the updater's own figures, used
    only if the block's dei-first share pull finds nothing.
    splits: [(date_iso, factor)] from Yahoo, or None if the split fetch
    failed (EPS history then ships unadjusted and flagged as such).
    fact_entries / ttm_value / latest_value: the updater's helpers.
    """
    def entries(tags):
        return fact_entries(facts, tags)

    def ttm(tags):
        val, _period = ttm_value(entries(tags))
        return val

    def latest(tags):
        val, _end = latest_value(entries(tags))
        return val

    # Reporting currency first, so every monetary pull below prefers
    # the same unit (TSM reports in TWD; mixing units across tags
    # would corrupt sums like enterprise value).
    eps_rows, eps_unit = _eps_rows_and_unit(facts)
    currency = None
    if eps_unit and "/" in eps_unit:
        currency = eps_unit.split("/")[0]
    money_units = [currency, "USD", "TWD"] if currency else ["USD", "TWD"]
    share_units = ([currency + "/shares"] if currency else []) + \
        ["USD/shares", "TWD/shares"]

    ebit = ttm(EBIT_TAGS)
    revenue = ttm(REVENUE_TAGS)
    net_income = ttm(NET_INCOME_TAGS)
    equity = latest(EQUITY_TAGS)
    lt_debt = latest(LT_DEBT_TAGS)
    cur_debt = latest(CUR_DEBT_TAGS)
    cash = latest(CASH_TAGS)
    cur_assets = latest(CURRENT_ASSET_TAGS)
    cur_liabs = latest(CURRENT_LIAB_TAGS)
    ppe = latest(PPE_TAGS)
    ocf = ttm(OCF_TAGS)
    capex = ttm(CAPEX_TAGS)
    div_paid_ttm = ttm(DIVIDENDS_PAID_TAGS)

    total_debt = None
    if lt_debt is not None or cur_debt is not None:
        total_debt = (lt_debt or 0.0) + (cur_debt or 0.0)

    # Shares: the block's own dei-first pull (see SHARE_TAGS_BLOCK).
    shares = None
    share_rows, _su = fact_rows(facts, SHARE_TAGS_BLOCK, ["shares"])
    if share_rows:
        share_rows_sorted = sorted(
            share_rows, key=lambda e: (e["end"], e.get("filed", "")))
        shares = share_rows_sorted[-1]["val"]
    if not shares:
        shares = fallback_shares

    market_cap_usd = None
    if price is not None and shares:
        market_cap_usd = price * shares
    elif mcap_billions is not None:
        market_cap_usd = mcap_billions * 1e9

    enterprise_value = None
    if market_cap_usd is not None:
        ev = market_cap_usd
        if total_debt is not None:
            ev += total_debt
        if cash is not None:
            ev -= cash
        enterprise_value = ev
    if currency and currency != "USD":
        # The page's price is a USD (ADS) price while the share count
        # and per-share figures are the filer's own (ordinary shares,
        # TWD for TSM). A market cap or EV mixed from the two would be
        # wrong, not approximate — ship neither. (Greenblatt excludes
        # TSM by rule regardless; Graham's price tests gate on the
        # currency on the page.)
        market_cap_usd = None
        enterprise_value = None

    # Greenblatt net working capital: (current assets - cash) -
    # (current liabilities - current debt) — the book's appendix form
    # on filed totals (excess cash beyond the cash line is not
    # separable in companyfacts).
    nwc_gb = None
    if cur_assets is not None and cur_liabs is not None:
        nwc_gb = (cur_assets - (cash or 0.0)) - (cur_liabs - (cur_debt or 0.0))

    current_ratio = None
    if cur_assets is not None and cur_liabs:
        current_ratio = round(cur_assets / cur_liabs, 2)

    debt_to_equity = None
    if total_debt is not None and equity:
        debt_to_equity = round(total_debt / equity, 2)

    bvps = None
    if equity is not None and shares:
        bvps = round(equity / shares, 4)

    net_cash_ps = None
    if cash is not None and shares:
        net_cash_ps = round((cash - (lt_debt or 0.0)) / shares, 4)

    fcf = None
    if ocf is not None and capex is not None:
        fcf = ocf - capex

    # ---- EPS: annual history + TTM, split-adjusted ----
    adjusted = splits is not None
    split_list = splits or []
    eps_hist = annual_eps_series(eps_rows, split_list, adjusted)
    eps_history = [[end, round(val, 4)] for end, val in eps_hist[-12:]]
    eps_avg_3y = None
    if len(eps_hist) >= 3:
        eps_avg_3y = round(sum(v for _e, v in eps_hist[-3:]) / 3.0, 4)
    eps_cagr = None
    if adjusted and len(eps_hist) >= 4:
        years = min(5, len(eps_hist) - 1)
        base = eps_hist[-1 - years][1]
        last = eps_hist[-1][1]
        if base and base > 0 and last and last > 0:
            eps_cagr = round(((last / base) ** (1.0 / years) - 1.0) * 100.0, 2)

    # TTM EPS, split-aware: latest adjusted annual + latest quarter -
    # same quarter last year, each quarterly figure from its original
    # filing and adjusted by the splits after that filing. Falls back
    # to the adjusted annual.
    eps_ttm = None
    if eps_hist:
        eps_ttm = eps_hist[-1][1]
        q_by_end = {}
        for e in eps_rows:
            if e.get("fp") in ("Q1", "Q2", "Q3"):
                q_by_end.setdefault(e["end"], []).append(e)
        quarters = {}
        for end, rows_at_end in q_by_end.items():
            val, filed = _pick_original(rows_at_end)
            quarters[end] = (val / split_factor_after(filed, split_list)
                             if adjusted else val)
        if quarters:
            q_end = max(quarters)
            prior_end = "%04d%s" % (int(q_end[:4]) - 1, q_end[4:])
            if prior_end in quarters and q_end > eps_hist[-1][0]:
                eps_ttm = (eps_hist[-1][1] + quarters[q_end]
                           - quarters[prior_end])
        eps_ttm = round(eps_ttm, 4)

    # ---- annual revenue / inventory / receivables (latest vs prior) ----
    def annual_latest_prior(tags, units, instant=False):
        rows, _u = fact_rows(facts, tags, units)
        series = (annual_series_instant(rows) if instant
                  else annual_series(rows))
        if not series:
            return None, None
        latest_v = series[-1][1]
        prior_v = series[-2][1] if len(series) >= 2 else None
        return latest_v, prior_v

    rev_a_latest, rev_a_prior = annual_latest_prior(REVENUE_TAGS, money_units)
    inv_latest, inv_prior = annual_latest_prior(INVENTORY_TAGS, money_units,
                                                instant=True)
    rec_latest, rec_prior = annual_latest_prior(RECEIVABLE_TAGS, money_units,
                                                instant=True)

    def growth_pct(latest_v, prior_v):
        if latest_v is None or not prior_v:
            return None
        return round((latest_v - prior_v) / abs(prior_v) * 100.0, 2)

    # ---- dividends: years covered by the filings + TTM per-share ----
    div_years = set()
    paid_rows, _u1 = fact_rows(facts, DIVIDENDS_PAID_TAGS, money_units)
    for end, val in annual_series(paid_rows):
        if val and val > 0:
            div_years.add(int(end[:4]))
    dps_rows, _u2 = fact_rows(facts, DPS_DECLARED_TAGS, share_units)
    for e in dps_rows:
        if e.get("val") and e["val"] > 0:
            div_years.add(int(e["end"][:4]))
    dividend_span = None
    dividend_years_20 = None
    if div_years:
        yrs = sorted(div_years)
        dividend_span = yrs[-1] - yrs[0] + 1
        window = set(range(yrs[-1] - 19, yrs[-1] + 1))
        dividend_years_20 = len(div_years & window)
    dps_ttm = None
    dividend_yield = None
    if div_paid_ttm is not None and shares:
        dps_ttm = round(div_paid_ttm / shares, 4)
        if price:
            dividend_yield = round(dps_ttm / price * 100.0, 2)

    return {
        "as_of": today,
        "source": "SEC EDGAR filings",
        "reporting_currency": currency,
        "ebit_ttm": ebit,
        "revenue_ttm": revenue,
        "net_income_ttm": net_income,
        "eps_ttm": eps_ttm,
        "eps_history": eps_history,
        "eps_history_adjusted": adjusted,
        "eps_avg_3y": eps_avg_3y,
        "eps_cagr_pct": eps_cagr,
        "enterprise_value": enterprise_value,
        "market_cap_usd": market_cap_usd,
        "total_debt": total_debt,
        "long_term_debt": lt_debt,
        "cash": cash,
        "current_assets": cur_assets,
        "current_liabilities": cur_liabs,
        "current_ratio": current_ratio,
        "net_working_capital_gb": nwc_gb,
        "net_fixed_assets": ppe,
        "equity": equity,
        "book_value_per_share": bvps,
        "debt_to_equity": debt_to_equity,
        "net_cash_per_share": net_cash_ps,
        "fcf_ttm": fcf,
        "revenue_annual_latest": rev_a_latest,
        "revenue_annual_prior": rev_a_prior,
        "revenue_growth_annual_pct": growth_pct(rev_a_latest, rev_a_prior),
        "inventory_latest": inv_latest,
        "inventory_prior": inv_prior,
        "inventory_growth_pct": growth_pct(inv_latest, inv_prior),
        "receivables_latest": rec_latest,
        "receivables_prior": rec_prior,
        "dividend_years_20": dividend_years_20,
        "dividend_span_years": dividend_span,
        "dps_ttm": dps_ttm,
        "dividend_yield_pct": dividend_yield,
        "shares_outstanding": shares,
    }


# =====================================================================
# Durability block (added 2026-11-17): the three decade measures
# computed from the same companyfacts payload the run already
# fetched — no new EDGAR calls. The page's reader is Buffett's
# scoreboard popover, which reads T1: in how many of the last N
# years the stock cleared Buffett's 15% ROE bar. A faithful port
# of the verified prototype:
# - T1 return persistence: ROE (net income / AVERAGE equity) at 15%+
#   in at least 7 of the last 10 fiscal years (>= 70% of the years
#   available with a shorter history; a company needs >= 5 graded
#   years before any test is reported).
# - T2 pricing power: the worst year's gross margin at least 60% of
#   the best year's, across the window (needs >= 4 margin years).
#   Financials (JPM, ASST) report no gross margin — t2 is "na" and
#   they grade on T1 + T3 alone.
# - T3 demand durability: revenue grew year over year in at least 7
#   of the last 10 years (>= 70% of the pairs available; needs >= 4
#   consecutive pairs to run).
# Annual figures are the latest-filed value per fiscal year (so
# restatements count), in one reporting currency per company (the
# unit with the most annual filings across the core tags), fiscal
# years labelled by period end. Stamp discipline as elsewhere: a
# failed computation preserves the previous run's block — main()
# replaces a ticker's block only on a successful computation, and
# never with an empty one where a real history already exists.
# =====================================================================

DURABILITY_FINANCIALS = {"JPM", "ASST"}

_DUR_NI_TAGS = [("us-gaap", "NetIncomeLoss"), ("ifrs-full", "ProfitLoss")]
_DUR_EQ_TAGS = [("us-gaap", "StockholdersEquity"),
                ("us-gaap", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"),
                ("ifrs-full", "Equity")]
_DUR_REV_TAGS = [("us-gaap", "Revenues"),
                 ("us-gaap", "RevenueFromContractWithCustomerExcludingAssessedTax"),
                 ("us-gaap", "SalesRevenueNet"),
                 ("ifrs-full", "Revenue")]
_DUR_GP_TAGS = [("us-gaap", "GrossProfit"), ("ifrs-full", "GrossProfit")]
_DUR_COST_TAGS = [("us-gaap", "CostOfRevenue"), ("us-gaap", "CostOfGoodsAndServicesSold"),
                  ("us-gaap", "CostOfGoodsSold"), ("ifrs-full", "CostOfSales")]


def _dur_parse_date(s):
    y, m, dd = s.split("-")
    return date(int(y), int(m), int(dd))


def _dur_tag_units(facts, taxonomy, tag):
    try:
        return facts["facts"][taxonomy][tag]["units"]
    except (KeyError, TypeError):
        return None


def _dur_annual_flow(facts, tag_list, unit=None):
    """{end_date: value} for annual (FY, ~1yr duration) flow entries.
    Latest-filed value wins per period end (captures restatements).
    If unit is given, only that unit's entries are used."""
    best = {}  # end -> (filed, val)
    for taxonomy, tag in tag_list:
        units = _dur_tag_units(facts, taxonomy, tag)
        if not units:
            continue
        for uname, entries in units.items():
            if unit is not None and uname != unit:
                continue
            for e in entries:
                if e.get("fp") != "FY":
                    continue
                if "start" not in e or "end" not in e or "val" not in e:
                    continue
                dur = (_dur_parse_date(e["end"]) - _dur_parse_date(e["start"])).days
                if not (300 <= dur <= 400):
                    continue
                end = e["end"]
                filed = e.get("filed", "")
                if end not in best or filed > best[end][0]:
                    best[end] = (filed, e["val"])
    return {end: val for end, (f, val) in best.items()}


def _dur_instant(facts, tag_list, unit=None):
    """{end_date: value} for instant (balance-sheet) entries, latest filed wins."""
    best = {}
    for taxonomy, tag in tag_list:
        units = _dur_tag_units(facts, taxonomy, tag)
        if not units:
            continue
        for uname, entries in units.items():
            if unit is not None and uname != unit:
                continue
            for e in entries:
                if "end" not in e or "val" not in e:
                    continue
                if "start" in e:
                    continue
                end = e["end"]
                filed = e.get("filed", "")
                if end not in best or filed > best[end][0]:
                    best[end] = (filed, e["val"])
    return {end: val for end, (f, val) in best.items()}


def _dur_merge(facts, tag_list, unit=None):
    """Merge annual flow series across fallback tags: earlier tags win per year."""
    merged = {}
    for tags in tag_list:
        s = _dur_annual_flow(facts, [tags], unit=unit)
        for end, val in s.items():
            if end not in merged:
                merged[end] = val
    return merged


def _dur_pick_unit(facts):
    """The reporting unit (currency) with the most annual FY entries
    across the core tags — used for ALL series so ratios never mix
    currencies."""
    counts = {}
    for tag_list in (_DUR_NI_TAGS, _DUR_REV_TAGS, _DUR_EQ_TAGS, _DUR_GP_TAGS):
        for taxonomy, tag in tag_list:
            units = _dur_tag_units(facts, taxonomy, tag)
            if not units:
                continue
            for uname, entries in units.items():
                n = sum(1 for e in entries if e.get("fp") == "FY")
                counts[uname] = counts.get(uname, 0) + n
    if not counts:
        return None
    return max(counts, key=counts.get)


def build_durability_block(facts, ticker):
    """The compact per-ticker durability block written into
    finance-data.json's top-level "durability" object, or None if the
    payload is unusable. Tests and bars: see the section comment."""
    if not facts or "facts" not in facts:
        return None
    unit = _dur_pick_unit(facts)
    ni = _dur_merge(facts, _DUR_NI_TAGS, unit)
    rev = _dur_merge(facts, _DUR_REV_TAGS, unit)
    gp = _dur_merge(facts, _DUR_GP_TAGS, unit)
    cost = _dur_merge(facts, _DUR_COST_TAGS, unit)
    eq = {}
    for tags in _DUR_EQ_TAGS:
        s = _dur_instant(facts, [tags], unit)
        for end, val in s.items():
            if end not in eq:
                eq[end] = val
    # gross profit fallback: revenue - cost of revenue
    if not gp:
        gp = {e: rev[e] - cost[e] for e in rev if e in cost}

    years = sorted(set(ni) | set(rev))
    rows = []
    prev_end = None
    for end in years:
        r = {"end": end, "ni": ni.get(end), "rev": rev.get(end),
             "eq": eq.get(end), "gp": gp.get(end), "roe": None, "gm": None}
        # ROE on average equity (prior year-end + this year-end) when
        # available; year-end equity as the first-year fallback.
        if r["ni"] is not None and r["eq"] is not None:
            prev_eq = eq.get(prev_end) if prev_end else None
            if prev_eq is not None and (prev_eq + r["eq"]) != 0:
                avg = (prev_eq + r["eq"]) / 2.0
                r["roe"] = (r["ni"] / avg * 100.0) if avg > 0 else None
            elif r["eq"] > 0:
                r["roe"] = r["ni"] / r["eq"] * 100.0
        if r["rev"] and r["gp"] is not None and r["rev"] != 0:
            r["gm"] = r["gp"] / r["rev"] * 100.0
        rows.append(r)
        prev_end = end

    # revenue growth pairs (consecutive fiscal years, ~1yr apart)
    rev_years = [r for r in rows if r["rev"] is not None]
    growth = {}  # end -> True/False grew vs prior year
    for a, b in zip(rev_years, rev_years[1:]):
        gap = (_dur_parse_date(b["end"]) - _dur_parse_date(a["end"])).days
        if 300 <= gap <= 400:
            growth[b["end"]] = b["rev"] > a["rev"]

    # ---- window: last 10 fiscal years with ROE-relevant data ----
    roe_rows = [r for r in rows if r["ni"] is not None and r["eq"] is not None][-10:]
    n_years = len(roe_rows)
    financial = ticker in DURABILITY_FINANCIALS
    block = {"years": n_years, "t1": None,
             "t2": {"na": True} if financial else None,
             "t3": None, "note": None}
    if n_years >= 5:
        # Test 1: return persistence
        good = sum(1 for r in roe_rows if r["roe"] is not None and r["roe"] >= 15.0)
        t1_pass = (good >= 7) if n_years == 10 else (good / n_years >= 0.7)
        block["t1"] = {"pass": t1_pass, "good": good, "n": n_years}
        # Test 2: pricing power (skipped for financials)
        if not financial:
            gms = [r["gm"] for r in roe_rows if r["gm"] is not None]
            if len(gms) >= 4:
                worst, bestm = min(gms), max(gms)
                ratio = (worst / bestm) if bestm > 0 else None
                block["t2"] = {"pass": (ratio is not None and ratio >= 0.60),
                               "worst": round(worst, 1), "best": round(bestm, 1)}
        # Test 3: demand durability — growth pairs ending in the window
        win_ends = [r["end"] for r in roe_rows]
        pairs_list = [growth[e] for e in win_ends if e in growth]
        inc = sum(1 for g in pairs_list if g)
        if len(pairs_list) == 10:
            t3_pass = inc >= 7
        elif len(pairs_list) >= 4:
            t3_pass = (inc / len(pairs_list)) >= 0.7
        else:
            t3_pass = None
        block["t3"] = {"pass": t3_pass, "inc": inc, "pairs": len(pairs_list)}
    # The note names the one thing a reader most needs to know about
    # this ticker's block — derived from the computed state, with the
    # two standing exceptions: NBIS's graded years are its predecessor
    # Yandex's, and MSTR's tests grade the operating business only
    # (its bitcoin treasury is invisible to them by design).
    if n_years == 0:
        block["note"] = "no_annuals"
    elif n_years < 5:
        block["note"] = "short_history"
    elif ticker == "NBIS":
        block["note"] = "predecessor"
    elif ticker == "MSTR":
        block["note"] = "treasury"
    elif financial:
        block["note"] = "financial"
    elif block["t3"] is not None and block["t3"]["pass"] is None:
        block["note"] = "short_revenue"
    return block


# =====================================================================
# Grade-history block (added 2026-11-18): the data behind the finance
# chart's Grades view — for each of the 19 stocks, each scored
# investor's grade through time, one point per week: how many of the
# investor's checkable rules the stock passed that week, and how many
# could be tested at all. Written to grades-history.json, which the
# page fetches only when a visitor switches the chart to Grades, so
# the Price view never pays for it.
#
# Point-in-time discipline (the backtest's rule, applied to
# fundamentals): a week is graded only from what was knowable that
# week. SEC filings count from their FILED date — the as-of facts are
# the companyfacts rows with filed <= that week's Friday, run through
# the SAME build_scoreboard_block and the SAME refresh math the live
# scoreboard uses, so a historical grade is the live grade as it
# would have been computed that week. Prices are that week's closes
# (Yahoo weekly bars, Friday-dated like fetch_chart_data.py's):
# split-adjusted closes for the ratio tests, adjusted closes for the
# momentum the page derives the same way from finance-history.json.
# Share counts are restated into today's share units (x the splits
# after each period end), the same adjustment the block's EPS history
# already makes, so per-share tests divide consistently.
#
# The eight formula investors get full weekly history. The ten
# judgment investors cannot be back-graded — their grades are
# judgments recorded on 2026-11-18, not formulas — so their series
# begin at that date with the snapshot counts read out of the page's
# QUALITATIVE_GRADES constant, and gain a new point only when a
# re-judging changes a count. No history is invented for them.
#
# Each ticker also carries a "combined" series (added 2026-11-18 for
# the scoreboard's chart view): per week, the investors who pass the
# stock out of the investors who could grade it, as a percentage —
# the scoreboard table's Score tally computed for every week from
# the same verdicts. Judgment points carry their verdict as a fourth
# element ([date, passed, tested, verdict]) because a verdict cannot
# be recovered from counts alone (gates); the Grades view reads only
# the first three elements, exactly as before.
#
# Record-level fields here are EDGAR-only: Alpha Vantage OVERVIEW is
# a current snapshot with no point-in-time form, so a historical PEG
# or ROE may differ slightly from the live figure on a week where
# OVERVIEW filled the live one. That is the honest direction: the
# history never borrows today's snapshot.
#
# Failure discipline, as elsewhere in this updater: a ticker whose
# facts, bars or split history can't be fetched tonight keeps its
# previous series unchanged; a failed judgment read keeps the
# previous judgment points; the file is replaced atomically and only
# when at least one ticker was recomputed or carried. The whole step
# runs after finance-data.json is written and can never block it.
# =====================================================================

GRADES_FILE = "grades-history.json"
GRADES_JUDGMENT_START = "2026-11-18"
GRADES_FORMULA_IDS = ["druckenmiller", "buffett", "tepper", "alden",
                      "oshaughnessy", "baker", "lynch", "graham"]
GRADES_FORMULA_NAMES = {
    "druckenmiller": "Druckenmiller", "buffett": "Buffett",
    "tepper": "Tepper", "alden": "Alden",
    "oshaughnessy": "O’Shaughnessy", "baker": "Baker",
    "lynch": "Lynch", "graham": "Graham",
}
GRADES_MAX_TESTED = {"druckenmiller": 1, "buffett": 1, "tepper": 1,
                     "alden": 1, "oshaughnessy": 1, "baker": 1,
                     "lynch": 6, "graham": 6}
GRADES_FINANCIALS = {"JPM", "ASST"}

_GH_TAG_LISTS = [
    EBIT_TAGS, REVENUE_TAGS, NET_INCOME_TAGS, EPS_TAGS, EQUITY_TAGS,
    LT_DEBT_TAGS, CUR_DEBT_TAGS, CASH_TAGS, CURRENT_ASSET_TAGS,
    CURRENT_LIAB_TAGS, PPE_TAGS, OCF_TAGS, CAPEX_TAGS,
    DIVIDENDS_PAID_TAGS, DPS_DECLARED_TAGS, SHARE_TAGS_BLOCK,
]
_GH_RELEVANT_TAGS = set()
for _gh_lst in _GH_TAG_LISTS:
    for _gh_pair in _gh_lst:
        _GH_RELEVANT_TAGS.add(_gh_pair)
_GH_SHARE_TAGS = set(SHARE_TAGS_BLOCK)


def gh_extract_relevant(facts):
    """A copy of the companyfacts payload holding only the tags the
    graded rules read (the scoreboard block's lists plus the refresh
    math's). Rows are shallow-copied so the as-of transforms below
    never mutate the caller's payload."""
    out = {"facts": {}}
    src = facts.get("facts") or {}
    for taxonomy, tag in _GH_RELEVANT_TAGS:
        try:
            units = src[taxonomy][tag]["units"]
        except (KeyError, TypeError):
            continue
        new_units = {}
        for unit, rows in units.items():
            kept = [dict(e) for e in rows if "end" in e and "val" in e]
            if kept:
                new_units[unit] = kept
        if new_units:
            out["facts"].setdefault(taxonomy, {})[tag] = {
                "units": new_units}
    return out


def _gh_filed_of(entry):
    return entry.get("filed") or entry.get("end") or ""


def gh_facts_asof(extracted, asof, splits):
    """The extracted facts as knowable on `asof`: only rows filed by
    then. Share-count rows are restated into today's share units
    (x the splits after the period end) so they divide consistently
    into split-adjusted prices and per-share figures."""
    out = {"facts": {}}
    for taxonomy, tags in extracted["facts"].items():
        for tag, payload in tags.items():
            new_units = {}
            for unit, rows in payload["units"].items():
                kept = []
                for e in rows:
                    if _gh_filed_of(e) > asof:
                        continue
                    e = dict(e)
                    if (taxonomy, tag) in _GH_SHARE_TAGS and unit == "shares":
                        e["val"] = e["val"] * split_factor_after(
                            e["end"], splits)
                    kept.append(e)
                if kept:
                    new_units[unit] = kept
            if new_units:
                out["facts"].setdefault(taxonomy, {})[tag] = {
                    "units": new_units}
    return out


def _gh_event_dates(extracted):
    """Every distinct filed date among the relevant rows: the dates
    on which the as-of facts state can change."""
    dates = set()
    for tags in extracted["facts"].values():
        for payload in tags.values():
            for rows in payload["units"].values():
                for e in rows:
                    f = _gh_filed_of(e)
                    if f:
                        dates.add(f)
    return sorted(dates)


def gh_record_fields_asof(facts_f):
    """The record-level fields the rules read (ROE, margin, growth,
    and the raw TTM EPS behind PEG), computed with main()'s own
    refresh math on the as-of facts. EDGAR only (see the banner)."""
    rev_entries = fact_entries(facts_f, [
        ("us-gaap", "Revenues"),
        ("us-gaap", "RevenueFromContractWithCustomerExcludingAssessedTax"),
        ("ifrs-full", "Revenue"),
    ])
    ni_entries = fact_entries(facts_f, [
        ("us-gaap", "NetIncomeLoss"),
        ("ifrs-full", "ProfitLoss"),
    ])
    eq_entries = fact_entries(facts_f, [
        ("us-gaap", "StockholdersEquity"),
        ("ifrs-full", "Equity"),
    ])
    eps_entries, eps_unit = fact_entries_with_unit(facts_f, [
        ("us-gaap", "EarningsPerShareDiluted"),
        ("ifrs-full", "DilutedEarningsPerShare"),
        ("ifrs-full", "DilutedEarningsLossPerShare"),
    ])
    ttm_rev, _p = ttm_value(rev_entries)
    ttm_ni, _p = ttm_value(ni_entries)
    ttm_eps, _p = ttm_value(eps_entries)
    if eps_unit and not eps_unit.startswith("USD"):
        # Per-share earnings in the filer's own currency cannot
        # divide a USD price — the same ruling as the refresh.
        ttm_eps = None
    equity, _e = latest_value(eq_entries)
    growth = None
    q_rev, q_rev_prior, _qe = latest_quarterly(rev_entries)
    if q_rev is not None and q_rev_prior:
        growth = round((q_rev - q_rev_prior) / abs(q_rev_prior) * 100.0, 2)
    else:
        a_rev, a_rev_prior, _ae = latest_annual(rev_entries)
        if a_rev is not None and a_rev_prior:
            growth = round((a_rev - a_rev_prior)
                           / abs(a_rev_prior) * 100.0, 2)
    roe = None
    if ttm_ni is not None and equity:
        roe = round(ttm_ni / equity * 100.0, 2)
    margin = None
    if ttm_ni is not None and ttm_rev:
        margin = round(ttm_ni / ttm_rev * 100.0, 2)
    return {"roe": roe, "margin": margin, "growth": growth,
            "eps_ttm_raw": ttm_eps}


def _gh_peg(rec, price):
    """main()'s PEG at an as-of price: (price / TTM EPS) / revenue
    growth, only when both the multiple and the growth are positive."""
    eps = rec.get("eps_ttm_raw")
    growth = rec.get("growth")
    if price is None or not eps or not growth:
        return None
    pe = price / eps
    if pe > 0 and growth > 0:
        return round(pe / growth, 2)
    return None


def gh_graham_checks(block, ticker, price):
    """The page's grahamChecks, verdicts only: a list of seven
    True / False / None in the page's order (size, strength,
    stability, dividends, growth, P/E, P/B). None for financials
    (excluded on the page) and for a missing block. The dividends
    test is never graded from this data — the page's own ruling."""
    if ticker in GRADES_FINANCIALS:
        return None
    s = block
    if not s:
        return None
    usd = (not s.get("reporting_currency")
           or s.get("reporting_currency") == "USD")
    out = []
    rev = s.get("revenue_ttm")
    out.append(None if rev is None else rev >= 1e8)
    if (s.get("current_ratio") is None or s.get("long_term_debt") is None
            or s.get("net_working_capital_gb") is None):
        out.append(None)
    else:
        out.append(s["current_ratio"] >= 2
                   and s["long_term_debt"] <= s["net_working_capital_gb"])
    hist = s.get("eps_history") or []
    if not s.get("eps_history_adjusted") or len(hist) < 10:
        out.append(None)
    else:
        out.append(all(h[1] > 0 for h in hist[-10:]))
    out.append(None)  # dividends: reported, never graded
    growth = None
    if s.get("eps_history_adjusted") and len(hist) >= 10:
        last_year = int(str(hist[-1][0])[:4])
        recent = sum(h[1] for h in hist[-3:]) / 3.0
        base_pts = [h[1] for h in hist
                    if last_year - 12 <= int(str(h[0])[:4]) <= last_year - 10]
        if len(base_pts) >= 2:
            b = sum(base_pts) / len(base_pts)
            if b > 0:
                growth = recent >= b * 4.0 / 3.0
    out.append(growth)
    if not usd:
        out.append(None)
    elif s.get("eps_avg_3y") is None:
        out.append(None)
    elif s["eps_avg_3y"] <= 0:
        out.append(False)
    elif price is None:
        out.append(None)
    else:
        out.append(price / s["eps_avg_3y"] <= 15)
    if not usd:
        out.append(None)
    elif s.get("book_value_per_share") is None:
        out.append(None)
    elif s["book_value_per_share"] <= 0:
        out.append(False)
    elif price is None:
        out.append(None)
    else:
        v = price / s["book_value_per_share"]
        pe_v = (price / s["eps_avg_3y"]
                if s.get("eps_avg_3y") and s["eps_avg_3y"] > 0 else None)
        out.append(v <= 1.5 or (pe_v is not None and pe_v * v <= 22.5))
    return out


def gh_lynch_checks(block, rec, price, ticker):
    """The page's lynchChecks, verdicts only: a dict of six
    True / False / None (peg, growth, debt, cash, inventory, divpeg).
    The dividend-adjusted PEG leg prices the dividend at the week's
    own close: the block's dps_ttm (a price-free figure) over that
    close, the block's own formula."""
    out = {"peg": None, "growth": None, "debt": None, "cash": None,
           "inventory": None, "divpeg": None}
    peg = _gh_peg(rec, price)
    if rec.get("growth") is not None and peg is not None \
            and rec["growth"] >= 20:
        if peg < 1.0:
            out["peg"] = True
        elif peg >= 2.0:
            out["peg"] = False
    s = block
    if not s:
        return out
    if s.get("eps_history_adjusted") and s.get("eps_cagr_pct") is not None:
        if s["eps_cagr_pct"] > 50:
            out["growth"] = False
        elif s["eps_cagr_pct"] >= 20:
            out["growth"] = True
    if ticker not in GRADES_FINANCIALS:
        if s.get("debt_to_equity") is not None:
            out["debt"] = s["debt_to_equity"] <= 1
        if s.get("net_cash_per_share") is not None:
            out["cash"] = s["net_cash_per_share"] > 0
    if (s.get("inventory_growth_pct") is not None
            and s.get("revenue_growth_annual_pct") is not None):
        out["inventory"] = (s["inventory_growth_pct"]
                            <= s["revenue_growth_annual_pct"])
    usd = (not s.get("reporting_currency")
           or s.get("reporting_currency") == "USD")
    yld = None
    if s.get("dps_ttm") is not None and price:
        yld = round(s["dps_ttm"] / price * 100.0, 2)
    if (usd and yld is not None and yld > 0
            and s.get("eps_ttm") is not None and s["eps_ttm"] > 0
            and price is not None and s.get("eps_history_adjusted")
            and s.get("eps_cagr_pct") is not None):
        ratio = (s["eps_cagr_pct"] + yld) / (price / s["eps_ttm"])
        if ratio >= 1.5:
            out["divpeg"] = True
        elif ratio < 1:
            out["divpeg"] = False
    return out


def _gh_passed_tested(checks):
    vals = (list(checks.values()) if isinstance(checks, dict)
            else list(checks))
    return (sum(1 for v in vals if v is True),
            sum(1 for v in vals if v is not None))


def _gh_week_friday(d):
    """The Friday of d's week — fetch_chart_data.py's convention:
    the next Friday on or after the date."""
    from datetime import timedelta
    return d + timedelta(days=(4 - d.weekday()) % 7)


def _gh_last_completed_friday(today, now_utc):
    """Most recent Friday whose trading week is finished (a Friday
    counts once past, or at/after 21:00 UTC that day) — the same
    rule fetch_chart_data.py keeps its bars by."""
    from datetime import timedelta
    this_fri = _gh_week_friday(today)
    if this_fri < today:
        return this_fri
    if this_fri == today and now_utc.hour >= 21:
        return today
    return this_fri - timedelta(days=7)


def gh_fetch_weekly_bars(symbol):
    """Weekly (friday, close, adjusted close) from Yahoo's v8 chart
    API, ten years, one call: the raw closes are split-adjusted (the
    ratio tests' basis) and the adjusted closes fold dividends in
    (the momentum basis, the page's own). Only completed weeks."""
    from datetime import datetime, timezone
    url = "https://query1.finance.yahoo.com/v8/finance/chart/%s" % symbol
    resp = requests.get(
        url,
        params={"range": "10y", "interval": "1wk", "events": "div,split"},
        headers={"User-Agent": "Mozilla/5.0 (compatible; "
                               "onealjb93.github.io finance updater)"},
        timeout=30)
    resp.raise_for_status()
    data = resp.json()
    result = (data.get("chart") or {}).get("result") or []
    if not result:
        raise ValueError("no chart result for %s" % symbol)
    result = result[0]
    stamps = result.get("timestamp") or []
    quote = result.get("indicators", {}).get("quote", [{}])[0]
    closes = quote.get("close") or []
    adj = (result.get("indicators", {}).get("adjclose") or [{}])[0]
    adjcloses = adj.get("adjclose") or []
    by_friday = {}
    for i, ts in enumerate(stamps):
        close = closes[i] if i < len(closes) else None
        if close is None or close <= 0:
            continue
        a = adjcloses[i] if i < len(adjcloses) else None
        d = datetime.fromtimestamp(ts, tz=timezone.utc).date()
        fri = _gh_week_friday(d).isoformat()
        by_friday[fri] = (fri, round(float(close), 4),
                          round(float(a), 4) if a
                          else round(float(close), 4))
    bars = [by_friday[k] for k in sorted(by_friday)]
    lcf = _gh_last_completed_friday(
        date.today(), datetime.now(timezone.utc)).isoformat()
    return [b for b in bars if b[0] <= lcf]


def gh_build_ticker_series(ticker, extracted, splits, bars):
    """One ticker's weekly (passed, tested) per formula investor,
    plus the per-week momentum and PEG the cross-sectional rules
    (O'Shaughnessy's rank, Baker's benchmark) read. The as-of block
    and record fields are rebuilt only at filing-event dates — the
    facts state cannot change between filings — and priced per week.
    """
    weeks = [b[0] for b in bars]
    if not weeks:
        return None
    events = _gh_event_dates(extracted)
    state_dates = sorted(set([weeks[0]] + [e for e in events
                                           if weeks[0] <= e <= weeks[-1]]))
    states = []
    for sd in state_dates:
        f_asof = gh_facts_asof(extracted, sd, splits)
        try:
            block = build_scoreboard_block(
                f_asof, None, None, None, splits,
                fact_entries, ttm_value, latest_value, sd)
        except Exception:
            block = None
        states.append((sd, block, gh_record_fields_asof(f_asof)))
    adj = [b[2] for b in bars]
    inv = {k: [] for k in GRADES_FORMULA_IDS}
    momentum = []
    pegs = []
    si = 0
    for i, wk in enumerate(weeks):
        while si + 1 < len(states) and states[si + 1][0] <= wk:
            si += 1
        _sd, block, rec = states[si]
        price = bars[i][1]
        mom = None
        if i >= 13 and adj[i - 13]:
            mom = round((adj[i] / adj[i - 13] - 1.0) * 10000) / 100.0
        momentum.append(mom)
        pegs.append(_gh_peg(rec, price))
        inv["druckenmiller"].append(
            (0, 0) if mom is None else (1 if mom > 0 else 0, 1))
        inv["buffett"].append(
            (0, 0) if rec["roe"] is None
            else (1 if rec["roe"] >= 15 else 0, 1))
        inv["tepper"].append(
            (0, 0) if rec["growth"] is None
            else (1 if rec["growth"] >= 10 else 0, 1))
        if rec["roe"] is None or rec["margin"] is None:
            inv["alden"].append((0, 0))
        else:
            inv["alden"].append(
                (1 if (rec["roe"] > 0 and rec["margin"] > 0) else 0, 1))
        inv["oshaughnessy"].append((0, 0))  # cross-sectional, below
        inv["baker"].append((0, 0))         # cross-sectional, below
        inv["lynch"].append(_gh_passed_tested(
            gh_lynch_checks(block, rec, price, ticker)))
        if ticker in GRADES_FINANCIALS:
            inv["graham"].append((0, 0))
        else:
            gc = gh_graham_checks(block, ticker, price)
            inv["graham"].append(
                (0, 0) if gc is None else _gh_passed_tested(gc))
    return {"weeks": weeks, "inv": inv, "momentum": momentum, "peg": pegs}


def _gh_apply_cross_sectional(per_ticker):
    """O'Shaughnessy (a top-5 momentum rank across the table that
    week — the page's rule, ties sharing the first index) and Baker
    (PEG under 1 and under half the expensive-AI benchmark, which on
    this table is AAOI's PEG — the page's EXPENSIVE_AI set)."""
    week_index = {t: {wk: i for i, wk in enumerate(res["weeks"])}
                  for t, res in per_ticker.items()}
    for t, res in per_ticker.items():
        for i, wk in enumerate(res["weeks"]):
            mom = res["momentum"][i]
            if mom is not None:
                all_moms = []
                for t2, res2 in per_ticker.items():
                    j = week_index[t2].get(wk)
                    if j is not None and res2["momentum"][j] is not None:
                        all_moms.append(res2["momentum"][j])
                ranked = sorted(all_moms, reverse=True)
                res["inv"]["oshaughnessy"][i] = (
                    1 if ranked.index(mom) < 5 else 0, 1)
            peg = res["peg"][i]
            med = None
            aaoi = per_ticker.get("AAOI")
            if aaoi is not None:
                j = week_index["AAOI"].get(wk)
                if j is not None:
                    med = aaoi["peg"][j]
            if peg is not None and med is not None:
                res["inv"]["baker"][i] = (
                    1 if (peg < 1.0 and peg < med / 2.0) else 0, 1)


def _gh_scan_object(text, start):
    """Index just past the closing brace of the object literal that
    opens at text[start], respecting double-quoted strings."""
    depth = 0
    i = start
    in_str = False
    esc = False
    while i < len(text):
        ch = text[i]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
        else:
            if ch == '"':
                in_str = True
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    return i + 1
        i += 1
    raise ValueError("unbalanced object literal")


def gh_extract_judgments(html):
    """The judgment investors' snapshot from the page's
    QUALITATIVE_GRADES constant: {investor: {"name":..., "tickers":
    {ticker: (passed, tested, verdict)}}}. The verdict is the page's
    own qualVerdict rule — every gate question passed and at least
    `min` of the five questions passed — computed from the recorded
    answers, because the combined score (below) needs each investor's
    PASS/FAIL, which the counts alone cannot give (a stock can pass
    3 of 5 questions and still fail a gate). The reasons stay on the
    page. Raises on any structural surprise; the caller keeps the
    previous points."""
    import re
    anchor = html.index("const QUALITATIVE_GRADES = {")
    obj_start = html.index("{", anchor)
    body = html[obj_start:_gh_scan_object(html, obj_start)]
    out = {}
    for m in re.finditer(r"\n            ([a-z]+): \{", body):
        inv = m.group(1)
        b_start = body.index("{", m.start())
        block = body[b_start:_gh_scan_object(body, b_start)]
        name_m = re.search(r'\bname: "([^"]+)"', block)
        gates_m = re.search(r'\bgates: \[([^\]]*)\]', block)
        gates = (re.findall(r'"([a-z]+)"', gates_m.group(1))
                 if gates_m else [])
        min_m = re.search(r'\bmin: (\d+)', block)
        if min_m is None:
            raise ValueError("%s: no min in the page constant" % inv)
        min_pass = int(min_m.group(1))
        j_anchor = block.index("judgments: {")
        j_start = block.index("{", j_anchor)
        jbody = block[j_start:_gh_scan_object(block, j_start)]
        per_ticker = {}
        for tm in re.finditer(r'\n                    "([A-Z]+)": \{',
                              jbody):
            tk = tm.group(1)
            t_start = jbody.index("{", tm.start())
            tobj = jbody[t_start:_gh_scan_object(jbody, t_start)]
            answers = dict((k, v == "true") for k, v in re.findall(
                r'"([a-z]+)": \[(true|false),', tobj))
            if len(answers) != 5:
                raise ValueError("%s/%s: %d judgments, expected 5"
                                 % (inv, tk, len(answers)))
            passed = sum(1 for a in answers.values() if a)
            verdict = (all(answers.get(g) for g in gates)
                       and passed >= min_pass)
            per_ticker[tk] = (passed, 5, verdict)
        # The page constant carries the core set. A stock added to
        # the grading set has no judgments until the next re-judging
        # records them, so the count is checked against the core
        # set, not the (possibly larger) grading set.
        if len(per_ticker) != len(CORE_TICKERS):
            raise ValueError("%s: %d tickers, expected %d"
                             % (inv, len(per_ticker),
                                len(CORE_TICKERS)))
        out[inv] = {"name": name_m.group(1) if name_m else inv,
                    "tickers": per_ticker}
    if not out:
        raise ValueError("no judgment investors found")
    return out


def _gh_formula_verdict(inv, cell):
    """One formula investor's PASS/FAIL verdict from a week's
    (passed, tested) counts — the page's own rule, inverted. The six
    single-rule investors pass exactly when their one check passes;
    Lynch passes when no checkable part of his checklist fails;
    Graham passes when every testable test passes and at least four
    of his tests could be tested (financials store (0, 0) — not
    graded). None when nothing could be tested that week."""
    if not cell:
        return None
    p, t = cell
    if t == 0:
        return None
    if inv == "graham" and t < 4:
        return None
    return p == t


def _gh_combined_series(entry):
    """One ticker's combined score per week: the investors who pass
    the stock that week, out of the investors whose tests could
    grade it that week, as a percentage rounded the way the page
    rounds its Score column (half up). The same tally the scoreboard
    table renders for today, computed for every week from the same
    point-in-time verdicts: formula verdicts inverted from the
    week's counts, judgment verdicts read off the standing judgment
    point (its fourth element) — a judgment point whose verdict is
    unknown (written before verdicts were recorded, with counts the
    current judging no longer reproduces) is left out of that week's
    count rather than guessed. None for a week nothing could grade.

    The standing judgment snapshot is dated after the last completed
    week in the series (it is judged from the current table), so at
    the series' final week — the current week, the one the table
    renders — the standing verdicts apply; at every earlier week a
    judgment point counts only from its own date forward, exactly
    as the page forward-fills it. Judgment history is still never
    back-filled: before the final week, the combined score rests on
    the formula investors alone.
    """
    import math
    weeks = entry.get("weeks") or []
    formula = entry.get("formula") or {}
    judgment = entry.get("judgment") or {}
    last_i = len(weeks) - 1
    out = []
    for i, wk in enumerate(weeks):
        passed = 0
        graded = 0
        for inv in GRADES_FORMULA_IDS:
            arr = formula.get(inv) or []
            cell = arr[i] if i < len(arr) else None
            v = _gh_formula_verdict(inv, cell)
            if v is not None:
                graded += 1
                if v:
                    passed += 1
        for pts in judgment.values():
            active = None
            for pt in pts:
                if pt[0] <= wk or i == last_i:
                    active = pt
                else:
                    break
            if active is None or len(active) < 4:
                continue
            graded += 1
            if active[3]:
                passed += 1
        out.append(int(math.floor(passed * 100.0 / graded + 0.5))
                   if graded else None)
    return out


def build_grades_history(previous, extracted_by_ticker, today):
    """Assemble grades-history.json. extracted_by_ticker maps ticker
    -> gh_extract_relevant(facts) for the tickers whose companyfacts
    arrived this run; any other ticker keeps its previous entry.
    Returns the document, or None when nothing could be carried or
    computed (the caller then leaves the previous file in place)."""
    prev_series = (previous or {}).get("series") or {}
    # Judgment snapshots: read the page's constant from the checkout.
    judgments = None
    try:
        with open("finance.html") as fh:
            judgments = gh_extract_judgments(fh.read())
    except Exception as exc:
        log("  grade history: judgment read failed (%s); previous "
            "judgment points carried" % exc)
    per_ticker = {}
    series = {}
    for symbol in TICKERS:
        prev_entry = prev_series.get(symbol)
        extracted = extracted_by_ticker.get(symbol)
        res = None
        if extracted is not None:
            try:
                bars = gh_fetch_weekly_bars(symbol)
                splits = fetch_splits_yahoo(symbol, http_get_json_yahoo)
                if splits is None:
                    raise ValueError("split history unavailable")
                res = gh_build_ticker_series(symbol, extracted, splits,
                                             bars)
            except Exception as exc:
                log("  grade history: %s recomputation failed (%s); "
                    "previous series carried" % (symbol, exc))
                res = None
        if res is not None:
            per_ticker[symbol] = res
            entry = {"weeks": res["weeks"], "formula": {}, "judgment": {}}
            series[symbol] = entry
        elif prev_entry is not None:
            entry = {"weeks": prev_entry.get("weeks") or [],
                     "formula": prev_entry.get("formula") or {},
                     "judgment": {}}
            series[symbol] = entry
        else:
            continue
        # Judgment points: begin at the grading date with the
        # snapshot counts and verdict; a new point lands when a
        # re-judging changes a count or the verdict. The page
        # forward-fills the standing grade.
        prev_judgment = (prev_entry or {}).get("judgment") or {}
        inv_ids = set(prev_judgment)
        if judgments:
            inv_ids |= set(judgments)
        for inv in sorted(inv_ids):
            pts = [list(p) for p in (prev_judgment.get(inv) or [])]
            if judgments and inv in judgments:
                counts = judgments[inv]["tickers"].get(symbol)
                if counts is not None:
                    p, t, verdict = counts
                    v01 = 1 if verdict else 0
                    if not pts:
                        pts = [[GRADES_JUDGMENT_START, p, t, v01]]
                    elif [pts[-1][1], pts[-1][2]] != [p, t] or (
                            len(pts[-1]) > 3
                            and bool(pts[-1][3]) != verdict):
                        # A re-judging changed the counts, or changed
                        # the verdict at the same counts (a gate
                        # flipped): a new point either way.
                        pts.append([today, p, t, v01])
                    elif len(pts[-1]) < 4:
                        # The standing point predates recorded
                        # verdicts and the current judging reproduces
                        # its counts exactly, so its verdict is this
                        # judging's verdict — complete it in place.
                        pts[-1] = [pts[-1][0], p, t, v01]
            if pts:
                entry["judgment"][inv] = pts
    if not series:
        return None
    _gh_apply_cross_sectional(per_ticker)
    for symbol, res in per_ticker.items():
        entry = series[symbol]
        for inv in GRADES_FORMULA_IDS:
            entry["formula"][inv] = [
                ([p, t] if t > 0 else None)
                for (p, t) in res["inv"][inv]]
    # The combined score: every week's tally over all 18 investors,
    # from the same verdicts assembled above (see _gh_combined_series).
    for entry in series.values():
        entry["combined"] = _gh_combined_series(entry)
    investors = {}
    for inv in GRADES_FORMULA_IDS:
        investors[inv] = {"name": GRADES_FORMULA_NAMES[inv],
                          "kind": "formula",
                          "max_tested": GRADES_MAX_TESTED[inv]}
    if judgments:
        for inv, data in judgments.items():
            investors[inv] = {"name": data["name"], "kind": "judgment",
                              "max_tested": 5}
    else:
        for inv, meta in ((previous or {}).get("investors") or {}).items():
            if meta.get("kind") == "judgment":
                investors[inv] = meta
    return {
        "generated": today,
        "grain": "weekly",
        "method": "Point-in-time: SEC filings count from the day they "
                  "were filed and prices are each week's closes, so "
                  "a grade is what the scoreboard would have said "
                  "that week.",
        "judgment_start": GRADES_JUDGMENT_START,
        "investors": investors,
        "series": series,
    }


def write_grades_history(previous, extracted_by_ticker, today):
    """Build and atomically write grades-history.json. Returns True
    when a file was written."""
    doc = build_grades_history(previous, extracted_by_ticker, today)
    if doc is None:
        log("  grade history: nothing to write; previous file kept")
        return False
    tmp_path = GRADES_FILE + ".tmp"
    with open(tmp_path, "w") as fh:
        json.dump(doc, fh, separators=(",", ":"))
    os.replace(tmp_path, GRADES_FILE)
    log("Wrote %s (%d tickers)." % (GRADES_FILE, len(doc["series"])))
    return True


def grades_only_main():
    """Standalone rehearsal / backfill: fetch the facts itself and
    write grades-history.json without the Alpha Vantage run. The
    weekday workflow never takes this path (it passes no flag)."""
    try:
        with open(GRADES_FILE) as fh:
            previous = json.load(fh)
    except (OSError, ValueError):
        previous = {}
    try:
        cik_map = load_cik_map()
    except Exception as exc:
        log("grade history: could not load cik_map.json: %s" % exc)
        return 1
    # Same gap-fill discipline as main(): a ticker added to the
    # grading set is not in the committed map yet, so the live SEC
    # file fills its CIK; a failed fill leaves it ungraded this
    # run rather than guessed.
    missing = [t for t in TICKERS if t not in cik_map]
    if missing:
        try:
            live_map = fetch_cik_map()
            for t in missing:
                if t in live_map:
                    cik_map[t] = live_map[t]
        except Exception as exc:
            log("  grade history: live CIK fill failed (%s); "
                "tickers without a CIK are skipped" % exc)
    extracted_by_ticker = {}
    for symbol in TICKERS:
        cik = cik_map.get(symbol)
        if not cik:
            continue
        try:
            facts = fetch_companyfacts(cik)
            extracted_by_ticker[symbol] = gh_extract_relevant(facts)
        except Exception as exc:
            log("  grade history: facts failed for %s: %s" % (symbol, exc))
    ok = write_grades_history(previous, extracted_by_ticker,
                              date.today().isoformat())
    return 0 if ok else 1


def fetch_splits_yahoo(symbol, http_get):
    """Split events for a ticker from Yahoo Finance's v8 chart API:
    [(date_iso, factor)] oldest first, factor = numerator/denominator
    (10 for a 10:1 split). http_get(url) -> parsed JSON is injected so
    the updater controls the request (and this stays testable).
    Raises on any failure — the caller treats that as 'unknown'."""
    from datetime import datetime, timezone
    url = ("https://query1.finance.yahoo.com/v8/finance/chart/%s"
           "?range=max&interval=1mo&events=split" % symbol)
    data = http_get(url)
    result = data["chart"]["result"][0]
    splits_map = (result.get("events") or {}).get("splits") or {}
    out = []
    for ts, ev in splits_map.items():
        num = ev.get("numerator")
        den = ev.get("denominator")
        if not num or not den:
            continue
        day = datetime.fromtimestamp(int(ts), tz=timezone.utc).date()
        out.append((day.isoformat(), float(num) / float(den)))
    return sorted(out)


def http_get_json_yahoo(url):
    """GET a Yahoo Finance JSON endpoint (keyless). Raises on failure."""
    resp = requests.get(
        url,
        headers={"User-Agent": "Mozilla/5.0 (compatible; "
                              "onealjb93.github.io finance updater)"},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


def fetch_preferred_close(symbol, http_get):
    """Latest COMPLETED trading day's close for a preferred ticker from
    Yahoo Finance's v8 chart API: (close, date_iso). http_get(url) ->
    parsed JSON is injected, matching fetch_splits_yahoo's pattern.
    Raises on any failure -- the caller carries the previous value
    forward. A bar dated today (America/New_York) counts only after
    the 4 p.m. ET close; the workflow runs at 22:00 UTC, so on a
    normal run today's bar is complete."""
    from datetime import datetime, time as dt_time, timezone
    try:
        from zoneinfo import ZoneInfo
        eastern = ZoneInfo("America/New_York")
    except Exception:
        eastern = timezone.utc
    url = ("https://query1.finance.yahoo.com/v8/finance/chart/%s"
           "?range=5d&interval=1d" % symbol)
    data = http_get(url)
    result = data["chart"]["result"][0]
    offset = int(result["meta"].get("gmtoffset") or 0)
    stamps = result.get("timestamp") or []
    quotes = (result.get("indicators") or {}).get("quote") or [{}]
    closes = quotes[0].get("close") or []
    now_et = datetime.now(eastern)
    best = None
    for ts, close in zip(stamps, closes):
        if close is None:
            continue
        day = datetime.fromtimestamp(int(ts) + offset,
                                     tz=timezone.utc).date()
        if day < now_et.date() or (
                day == now_et.date() and now_et.time() >= dt_time(16, 0)):
            if best is None or day > best[1]:
                best = (round(float(close), 2), day)
    if best is None:
        raise ValueError("no completed daily bar for %s" % symbol)
    return best[0], best[1].isoformat()


def build_preferreds_block(previous_preferreds, http_get):
    """The "preferreds" block for finance-data.json: latest close, its
    date, and the issuer-declared annual dividend for STRC and SATS,
    refreshed on EVERY run (Yahoo only -- zero Alpha Vantage calls),
    so the member card's yield equation is current whenever the page
    opens. Failure discipline: a failed fetch carries that ticker's
    previous entry forward unchanged; an entry is omitted only when
    there is no previous value either. Never writes nulls, never
    drops an existing entry."""
    previous_preferreds = previous_preferreds or {}
    block = {}
    for symbol in PREFERRED_TICKERS:
        entry = None
        try:
            price, price_date = fetch_preferred_close(symbol, http_get)
            entry = {"price": price, "price_date": price_date,
                     "annual_dividend": PREFERRED_DIVIDENDS[symbol]}
            log("  Preferreds: %s close %.2f on %s (dividend %.2f/yr)"
                % (symbol, price, price_date, entry["annual_dividend"]))
        except Exception as exc:
            old = previous_preferreds.get(symbol)
            if old:
                entry = old
                log("  Preferreds: %s fetch failed (%s); carried the "
                    "%s entry forward" % (symbol, exc,
                                          old.get("price_date")))
            else:
                log("  Preferreds: %s fetch failed (%s); no previous "
                    "value to carry forward" % (symbol, exc))
        if entry is not None:
            block[symbol] = entry
    return block


def main():
    api_key = os.environ.get("API_KEY")
    if not api_key:
        log("ERROR: API_KEY is not set in the environment. Nothing was written.")
        return 2

    try:
        with open(DATA_FILE) as fh:
            raw_previous = json.load(fh)
        previous = {s["ticker"]: s for s in raw_previous.get("stocks", [])}
        previous_preferreds = raw_previous.get("preferreds") or {}
        previous_durability = raw_previous.get("durability") or {}
    except (OSError, ValueError):
        previous = {}
        previous_preferreds = {}
        previous_durability = {}

    try:
        with open(GRADES_FILE) as fh:
            previous_grades = json.load(fh)
    except (OSError, ValueError):
        previous_grades = {}

    # Ticker->CIK map: the committed cik_map.json is the primary source,
    # because the live SEC file 403s automated access from cloud IPs
    # ("Request Rate Threshold Exceeded") and a failed map fetch used to
    # kill the whole run before any price was fetched. The live fetch only
    # fills gaps; if it fails too, the run proceeds and tickers without a
    # CIK get null fundamentals (never a guess), per the honesty rules.
    try:
        cik_map = load_cik_map()
    except Exception as exc:
        log("WARNING: could not load committed cik_map.json: %s" % exc)
        cik_map = {}
    missing = [t for t in TICKERS if t not in cik_map]
    if missing:
        try:
            live_map = fetch_cik_map()
            filled = [t for t in missing if t in live_map]
            for t in filled:
                cik_map[t] = live_map[t]
            log("  CIK map: %d from cik_map.json, %d filled from live SEC fetch"
                % (len(TICKERS) - len(missing), len(filled)))
        except Exception as exc:
            log("WARNING: live SEC ticker->CIK fetch failed (%s); proceeding "
                "with committed map only — %d ticker(s) without a CIK will "
                "have null EDGAR fields." % (exc, len(missing)))
    else:
        log("  CIK map: all %d tickers from cik_map.json" % len(TICKERS))

    today = date.today().isoformat()
    stocks = []
    durability = {}
    gh_extracted = {}
    overview_calls = 0

    # Tickers whose fundamentals are > 7 days stale (or missing) get refreshed
    # first; OVERVIEW is capped at 4 calls per run.
    def fundamentals_due(ticker):
        prev = previous.get(ticker) or {}
        as_of = prev.get("fundamentals_as_of")
        if not as_of:
            return True
        try:
            y, m, d = (int(x) for x in as_of.split("-"))
            return (date.today() - date(y, m, d)).days > FUNDAMENTALS_STALE_DAYS
        except ValueError:
            return True

    due = [t for t in TICKERS if fundamentals_due(t)]

    # Per-run fundamentals bookkeeping, written into finance-data.json as
    # "fundamentals_status" so a failed refresh is visible in the data
    # itself, not only in this run's log (the 2026-11-16 lesson).
    fstatus = {
        "run_date": today,
        "due_tickers": list(due),
        "edgar": {"attempted": 0, "ok": 0, "blocked": 0, "failed": 0,
                  "detail": None},
        "overview": {"attempted": 0, "filled": 0, "failed": 0,
                     "throttled": False, "detail": None},
        "av_calls": 0,
        "tickers_filled": [],
        "tickers_still_missing": [],
    }
    overview_throttled = False

    for symbol in TICKERS:
        log("=== %s ===" % symbol)
        prev = previous.get(symbol) or {}
        record = {
            "ticker": symbol,
            "name": prev.get("name") or symbol,
            # Institutional ownership: no free source; author's estimate, carried
            # forward unchanged and labelled as such on the page.
            "inst": prev.get("inst"),
        }

        # ---- price (daily, Alpha Vantage) ----
        try:
            price, price_as_of = fetch_quote(api_key, symbol)
        except RateLimited as exc:
            log("ERROR: %s" % exc)
            log("Stopping without writing: partial data would be misleading.")
            return 1
        record["price"] = price
        record["price_as_of"] = price_as_of
        record["price_source"] = "Alpha Vantage" if price is not None else None
        time.sleep(12)  # 5/min free limit

        # ---- momentum + price cross-check (daily, Stooq) ----
        history = fetch_stooq_history(symbol)
        mom, mom_as_of = momentum_3m(history)
        record["momentum"] = mom
        record["momentum_as_of"] = mom_as_of
        if history and price is not None:
            stooq_close = history[-1][1]
            diff = abs(stooq_close - price) / price * 100.0
            log("  price cross-check: AV $%.2f vs Stooq $%.2f (%.2f%%)"
                % (price, stooq_close, diff))
            if diff > 2.0:
                log("  WARNING: AV/Stooq price mismatch > 2%% for %s" % symbol)
        elif history:
            log("  Stooq latest close for %s: $%.2f on %s"
                % (symbol, history[-1][1], history[-1][0]))

        # ---- EDGAR: shares (daily, for market cap) + fundamentals (weekly) ----
        cik = cik_map.get(symbol)
        shares = None
        facts = None
        edgar_outcome = "no_cik"
        if cik:
            fstatus["edgar"]["attempted"] += 1
            try:
                facts = fetch_companyfacts(cik)
                edgar_outcome = "ok"
                fstatus["edgar"]["ok"] += 1
            except EdgarBlocked as exc:
                edgar_outcome = "blocked"
                fstatus["edgar"]["blocked"] += 1
                if fstatus["edgar"]["detail"] is None:
                    fstatus["edgar"]["detail"] = str(exc)
                log("  EDGAR blocked for %s: %s" % (symbol, exc))
                log("  NOTE: if %s is due a fundamentals refresh, Alpha "
                    "Vantage OVERVIEW below becomes its fundamentals "
                    "source instead." % symbol)
            except Exception as exc:
                edgar_outcome = "failed"
                fstatus["edgar"]["failed"] += 1
                if fstatus["edgar"]["detail"] is None:
                    fstatus["edgar"]["detail"] = str(exc)
                log("  EDGAR companyfacts failed for %s: %s" % (symbol, exc))
        else:
            log("  no CIK found for %s; EDGAR fields will be null" % symbol)

        # Specific, diagnosed reason when EDGAR answered but a field
        # still can't be formed — surfaced in fundamentals_note below
        # instead of the generic "did not yield" wording.
        edgar_gap_detail = None
        if facts is not None:
            # dei cover-page count first, then the us-gaap outstanding
            # series, then the diluted weighted average (the
            # scoreboard block's order). The old ifrs IssuedCapital
            # fallback is gone: it is share CAPITAL in money, not a
            # share count — reading it as one put TSM's "market cap"
            # at $103 trillion (its NT$259B issued capital x the ADS
            # price).
            share_entries = fact_entries(facts, [
                ("dei", "EntityCommonStockSharesOutstanding"),
                ("us-gaap", "CommonStockSharesOutstanding"),
                ("us-gaap", "WeightedAverageNumberOfDilutedSharesOutstanding"),
            ])
            shares, _share_end = latest_value(share_entries)

        # A filer reporting in a non-USD currency carries an
        # ordinary-share count while the page's price is a USD ADS
        # price (TSM: TWD figures, 1 ADS = 5 ordinary shares). A
        # market cap multiplied across that mismatch would be wrong,
        # not approximate — leave it blank and say why (the same
        # ruling the scoreboard block applies).
        mcap_currency = None
        if facts is not None:
            _eps_rows_probe, _eps_unit_probe = _eps_rows_and_unit(facts)
            if _eps_unit_probe and "/" in _eps_unit_probe:
                mcap_currency = _eps_unit_probe.split("/")[0]
        if price is not None and shares and mcap_currency in (None, "USD"):
            mcap_b = price * shares / 1e9
            record["mcap"] = round(mcap_b, 2)
            record["mcap_str"] = money_str(mcap_b)
        else:
            record["mcap"] = None
            record["mcap_str"] = None
            if price is not None and shares and mcap_currency not in (None, "USD"):
                edgar_gap_detail = (
                    "its filings report in %s and carry an "
                    "ordinary-share count, while the price is the USD "
                    "ADS price, so a market cap from these filings "
                    "would mix the two" % mcap_currency)
                log("  %s reports in %s; share count is ordinary shares "
                    "but the price is the USD ADS price — market cap "
                    "left blank rather than mixing the two"
                    % (symbol, mcap_currency))
            elif price is not None:
                log("  no share count for %s; market cap null" % symbol)

        # ---- durability block (decade tests; local computation on
        # the companyfacts payload already fetched — no new calls).
        # Stamp discipline: a failed or empty computation preserves
        # the previous run's block for this ticker.
        dur_block = None
        if facts is not None:
            try:
                dur_block = build_durability_block(facts, symbol)
            except Exception as exc:
                dur_block = None
                log("  durability block failed for %s: %s" % (symbol, exc))
        prev_dur = previous_durability.get(symbol)
        if dur_block is None or (dur_block.get("years") == 0
                                 and prev_dur and prev_dur.get("years")):
            dur_block = prev_dur
        if dur_block is not None:
            durability[symbol] = dur_block

        # ---- grade-history inputs: the rule-relevant slice of the
        # same companyfacts payload, kept for the step after the loop.
        if facts is not None:
            try:
                gh_extracted[symbol] = gh_extract_relevant(facts)
            except Exception as exc:
                log("  grade history: extraction failed for %s: %s"
                    % (symbol, exc))

        # ---- fundamentals (weekly rotation) ----
        refresh = symbol in due and facts is not None
        if refresh:
            log("  refreshing fundamentals for %s" % symbol)
            rev_entries = fact_entries(facts, [
                ("us-gaap", "Revenues"),
                ("us-gaap", "RevenueFromContractWithCustomerExcludingAssessedTax"),
                ("ifrs-full", "Revenue"),
            ])
            ni_entries = fact_entries(facts, [
                ("us-gaap", "NetIncomeLoss"),
                ("ifrs-full", "ProfitLoss"),
            ])
            eq_entries = fact_entries(facts, [
                ("us-gaap", "StockholdersEquity"),
                ("ifrs-full", "Equity"),
            ])
            ltd_entries = fact_entries(facts, [
                ("us-gaap", "LongTermDebt"),
                ("ifrs-full", "NonCurrentBorrowings"),
            ])
            cur_entries = fact_entries(facts, [
                ("us-gaap", "LongTermDebtCurrent"),
                ("us-gaap", "ShortTermBorrowings"),
                ("ifrs-full", "CurrentBorrowings"),
            ])
            eps_entries, eps_unit = fact_entries_with_unit(facts, [
                ("us-gaap", "EarningsPerShareDiluted"),
                ("ifrs-full", "DilutedEarningsPerShare"),
                ("ifrs-full", "DilutedEarningsLossPerShare"),
            ])

            ttm_rev, rev_period = ttm_value(rev_entries)
            ttm_ni, _ni_period = ttm_value(ni_entries)
            ttm_eps, _eps_period = ttm_value(eps_entries)
            if eps_unit and not eps_unit.startswith("USD"):
                # EPS in the filer's own currency (TSM: TWD per
                # ordinary share) cannot divide a USD ADS price —
                # the PEG would be wrong, not approximate.
                log("  EPS for %s is in %s; PEG left blank rather than "
                    "dividing a USD price by it" % (symbol, eps_unit))
                ttm_eps = None
            equity, _eq_end = latest_value(eq_entries)
            ltd, _ltd_end = latest_value(ltd_entries)
            cur, _cur_end = latest_value(cur_entries)

            # Revenue growth YoY: latest quarter vs same quarter last year.
            growth = None
            q_rev, q_rev_prior, _q_end = latest_quarterly(rev_entries)
            if q_rev is not None and q_rev_prior:
                growth = round((q_rev - q_rev_prior) / abs(q_rev_prior) * 100.0, 2)
            else:
                a_rev, a_rev_prior, _a_end = latest_annual(rev_entries)
                if a_rev is not None and a_rev_prior:
                    growth = round((a_rev - a_rev_prior) / abs(a_rev_prior) * 100.0, 2)

            total_debt = None
            if ltd is not None or cur is not None:
                total_debt = (ltd or 0.0) + (cur or 0.0)
            debt_to_equity = None
            if total_debt is not None and equity:
                debt_to_equity = round(total_debt / equity, 2)

            roe = None
            if ttm_ni is not None and equity:
                roe = round(ttm_ni / equity * 100.0, 2)
            margin = None
            if ttm_ni is not None and ttm_rev:
                margin = round(ttm_ni / ttm_rev * 100.0, 2)

            # PEG: computed as (price / diluted EPS TTM) / revenue growth.
            # Only when both are positive — Lynch's ratio is undefined
            # for a loss-maker or a shrinking company, and a negative
            # "PEG" is a nonsense number, not a bearish signal.
            peg = None
            if price is not None and ttm_eps and growth:
                pe = price / ttm_eps
                if pe > 0 and growth > 0:
                    peg = round(pe / growth, 2)

            record["peg"] = peg
            record["growth"] = growth
            record["debt"] = debt_to_equity
            record["roe"] = roe
            record["margin"] = margin
            if edgar_gap_detail is None and (roe is None or margin is None):
                has_annual = any(
                    e[2] in ANNUAL_FORMS for e in rev_entries + ni_entries)
                if not has_annual and ttm_rev is None and ttm_ni is None:
                    # SPCX: two 10-Qs since the June 2026 IPO, no
                    # annual report, and Q4 of the pre-IPO year was
                    # never filed as a figure — a trailing twelve
                    # months does not yet exist in its filings.
                    edgar_gap_detail = (
                        "its filings hold quarterly reports only, "
                        "with no annual report yet, so a trailing "
                        "twelve months cannot be formed from them")
                elif ttm_rev is None:
                    edgar_gap_detail = (
                        "its filings did not yield a trailing-twelve-"
                        "month revenue figure")
                elif ttm_ni is None:
                    edgar_gap_detail = (
                        "its filings did not yield a trailing-twelve-"
                        "month net income figure")
            record["analyst_target"] = None  # filled from OVERVIEW below, if any
            # Stamp the refresh date only when the refresh yielded the
            # core fields, or the filings genuinely cannot yield them
            # yet (diagnosed no-TTM case). A failed attempt must not
            # reset the weekly clock and hide the ticker for 7 days.
            if (roe is not None and margin is not None) or (
                    edgar_gap_detail and "trailing" in edgar_gap_detail
                    and "cannot be formed" in edgar_gap_detail):
                record["fundamentals_as_of"] = today
            else:
                record["fundamentals_as_of"] = prev.get("fundamentals_as_of")
            record["fundamentals_source"] = "SEC EDGAR filings"
            record["fiscal_period"] = (
                "fiscal period ended %s" % rev_period if rev_period else None
            )

            # ---- scoreboard block (Greenblatt / Graham / Lynch) ----
            # Split data is not optional for this block: without it the
            # EPS history is unadjusted, eps_cagr_pct comes out null,
            # and Lynch's growth and dividend-PEG legs grade dark on
            # the page. (The 2026-11-18 lesson: that day's blocks were
            # all built unadjusted and then carried forward for days,
            # so the table graded on degraded inputs while the
            # point-in-time grades history graded the same stocks with
            # the legs lit — the two disagreed.) A splits failure
            # therefore fails this ticker's block refresh loudly: the
            # previous block is kept with its own as_of stamp, and no
            # degraded block is built or stamped with today's date.
            try:
                splits = fetch_splits_yahoo(symbol, http_get_json)
            except Exception as exc:
                splits = None
                log("  SCOREBOARD BLOCK NOT REFRESHED for %s: split "
                    "history unavailable (%s); previous block kept "
                    "with its original as_of" % (symbol, exc))
            if splits is None:
                record["scoreboard"] = prev.get("scoreboard")
            else:
                try:
                    record["scoreboard"] = build_scoreboard_block(
                        facts, price, shares, record.get("mcap"), splits,
                        fact_entries, ttm_value, latest_value, today)
                except Exception as exc:
                    record["scoreboard"] = None
                    log("  scoreboard block failed for %s: %s"
                        % (symbol, exc))
        else:
            # Not due (or no EDGAR data): carry the previous fundamentals.
            for key in ("peg", "growth", "debt", "roe", "margin",
                        "analyst_target", "fundamentals_as_of",
                        "fundamentals_source", "fiscal_period",
                        "scoreboard"):
                record[key] = prev.get(key)

        # ---- OVERVIEW (max 4/day, only for tickers due a refresh) ----
        ov_outcome = "not_attempted"
        ov_filled = False
        if (symbol in due and overview_calls < OVERVIEW_MAX_PER_RUN
                and not overview_throttled):
            overview_calls += 1
            fstatus["overview"]["attempted"] += 1
            ov = None
            try:
                ov = fetch_overview(api_key, symbol)
            except RateLimited as exc:
                # Fundamentals-phase throttle: the prices are already
                # complete, so record it loudly (fundamentals_status +
                # the ticker notes below), make no further OVERVIEW
                # calls this run, and still write. A price-phase
                # throttle (above) still aborts with nothing written.
                overview_throttled = True
                ov_outcome = "throttled"
                fstatus["overview"]["throttled"] = True
                fstatus["overview"]["detail"] = str(exc)[:300]
                log("  OVERVIEW throttled for %s: %s" % (symbol, exc))
                log("  No further OVERVIEW calls this run; the throttle "
                    "is recorded in fundamentals_status.")
            time.sleep(12)  # 5/min free limit
            if ov:
                ov_peg = parse_float(ov.get("PEGRatio"))
                if ov_peg is not None:
                    record["peg"] = ov_peg
                target = parse_float(ov.get("AnalystTargetPrice"))
                if target is not None:
                    record["analyst_target"] = target
                # Cross-checks (logged, never silently overwritten).
                ov_mcap = parse_float(ov.get("MarketCapitalization"))
                if ov_mcap is not None and record.get("mcap") is not None:
                    ov_mcap_b = ov_mcap / 1e9
                    diff = abs(ov_mcap_b - record["mcap"]) / record["mcap"] * 100.0
                    log("  mcap cross-check: computed $%.2fB vs OVERVIEW $%.2fB (%.1f%%)"
                        % (record["mcap"], ov_mcap_b, diff))
                    if diff > 15.0:
                        log("  WARNING: market-cap mismatch > 15%% for %s" % symbol)
                ov_roe = parse_float(ov.get("ReturnOnEquityTTM"))
                if ov_roe is not None and record.get("roe") is not None:
                    log("  ROE cross-check: EDGAR %.2f%% vs OVERVIEW %.2f%%"
                        % (record["roe"], ov_roe * 100.0))
                ov_growth = parse_float(ov.get("QuarterlyRevenueGrowthYOY"))
                if ov_growth is not None and record.get("growth") is None:
                    record["growth"] = round(ov_growth * 100.0, 2)
                # Fill any fundamental EDGAR left empty from OVERVIEW's own
                # fields — real values from a named source, never an
                # estimate, and never overwriting an EDGAR value.
                roe_before, margin_before = record.get("roe"), record.get("margin")
                mcap_before = record.get("mcap")
                ov_roe = parse_float(ov.get("ReturnOnEquityTTM"))
                if roe_before is None and ov_roe is not None:
                    record["roe"] = round(ov_roe * 100.0, 2)
                ov_margin = parse_float(ov.get("ProfitMargin"))
                if margin_before is None and ov_margin is not None:
                    record["margin"] = round(ov_margin * 100.0, 2)
                if record.get("mcap") is None and ov_mcap is not None:
                    record["mcap"] = round(ov_mcap / 1e9, 2)
                    record["mcap_str"] = money_str(ov_mcap / 1e9)
                if record.get("fundamentals_source") == "SEC EDGAR filings":
                    record["fundamentals_source"] = (
                        "SEC EDGAR filings + Alpha Vantage OVERVIEW"
                    )
                # Fallback of record: this ticker was due a refresh and
                # OVERVIEW supplied at least one of ROE / margin / market
                # cap that EDGAR didn't (EDGAR branch never ran, or left
                # them empty). Only then does OVERVIEW become the source
                # of record and the refresh date stamp — an OVERVIEW that
                # answered but supplied none of the three no longer
                # stamps the date, so the ticker stays in the queue
                # instead of rotating away still empty. Stamping moves
                # the weekly rotation on to the next tickers.
                ov_filled = (roe_before is None and record.get("roe") is not None) or \
                            (margin_before is None and record.get("margin") is not None) or \
                            (mcap_before is None and record.get("mcap") is not None)
                if record.get("fundamentals_source") is None and ov_filled:
                    record["fundamentals_source"] = "Alpha Vantage OVERVIEW"
                    lq = ov.get("LatestQuarter")
                    if lq:
                        record["fiscal_period"] = "quarter ended %s" % lq
                    log("  fundamentals for %s from Alpha Vantage OVERVIEW "
                        "(EDGAR unavailable): ROE %s, margin %s, mcap %s"
                        % (symbol, record.get("roe"), record.get("margin"),
                           record.get("mcap_str")))
                    record["fundamentals_as_of"] = today
            if ov_outcome != "throttled":
                if ov:
                    ov_outcome = "filled" if ov_filled else "answered_no_fill"
                    if ov_filled:
                        fstatus["overview"]["filled"] += 1
                else:
                    ov_outcome = "failed"
                    fstatus["overview"]["failed"] += 1
                    if fstatus["overview"]["detail"] is None:
                        fstatus["overview"]["detail"] = _last_overview_error[0]

        # ---- fundamentals note: what happened to this ticker's refresh ----
        # Written for every record, so the data always says why a due
        # ticker's fundamentals did or didn't move (never silent nulls).
        if symbol in due:
            complete = (record.get("roe") is not None
                        and record.get("margin") is not None
                        and record.get("mcap") is not None)
            if complete and record.get("fundamentals_as_of") == today:
                fstatus["tickers_filled"].append(symbol)
                record["fundamentals_note"] = None
            else:
                fstatus["tickers_still_missing"].append(symbol)
                if edgar_outcome == "blocked":
                    edgar_part = "SEC EDGAR blocked the request (HTTP 403)"
                elif edgar_outcome == "failed":
                    edgar_part = "the SEC EDGAR request failed"
                elif edgar_outcome == "ok":
                    if edgar_gap_detail:
                        edgar_part = ("SEC EDGAR answered, but "
                                      + edgar_gap_detail)
                    else:
                        edgar_part = ("SEC EDGAR answered, but its filings did "
                                      "not yield ROE, margin and market cap")
                else:
                    edgar_part = "no SEC CIK is on file for this ticker"
                if ov_outcome == "throttled" or (
                        overview_throttled and ov_outcome == "not_attempted"):
                    ov_part = ("Alpha Vantage's free daily limit was "
                               "already reached, so OVERVIEW wrote nothing")
                elif ov_outcome == "failed":
                    ov_part = "the Alpha Vantage OVERVIEW call failed (%s)" \
                        % (_last_overview_error[0] or "unknown error")
                elif ov_outcome == "answered_no_fill":
                    ov_part = ("Alpha Vantage OVERVIEW answered but "
                               "supplied none of ROE, margin or market cap")
                elif ov_outcome == "filled":
                    ov_part = ("Alpha Vantage OVERVIEW filled some fields, "
                               "but ROE, margin and market cap are still "
                               "not all present")
                else:
                    ov_part = ("this ticker is waiting for its turn in "
                               "the Alpha Vantage OVERVIEW rotation "
                               "(at most %d per run)" % OVERVIEW_MAX_PER_RUN)
                record["fundamentals_note"] = (
                    "Fundamentals refresh attempted %s: %s; %s. The "
                    "figures shown are the last available."
                    % (today, edgar_part, ov_part)
                )
        else:
            if (record.get("roe") is not None
                    and record.get("margin") is not None
                    and record.get("mcap") is not None):
                record["fundamentals_note"] = None
            else:
                record["fundamentals_note"] = prev.get("fundamentals_note")

        stocks.append(record)

    fstatus["av_calls"] = _av_call_count[0]
    preferreds = build_preferreds_block(previous_preferreds,
                                        http_get_json_yahoo)
    output = {"last_updated": today, "fundamentals_status": fstatus,
              "stocks": stocks, "preferreds": preferreds,
              "durability": durability}
    with open(DATA_FILE, "w") as fh:
        json.dump(output, fh, indent=2)
    log("Wrote %s (%d tickers, %d OVERVIEW calls, %d Alpha Vantage calls "
        "total)." % (DATA_FILE, len(stocks), overview_calls,
                     _av_call_count[0]))
    log("Fundamentals: EDGAR ok %d / blocked %d / failed %d of %d "
        "attempted; OVERVIEW filled %d, failed %d, throttled %s; "
        "%d due ticker(s) filled, %d still missing."
        % (fstatus["edgar"]["ok"], fstatus["edgar"]["blocked"],
           fstatus["edgar"]["failed"], fstatus["edgar"]["attempted"],
           fstatus["overview"]["filled"], fstatus["overview"]["failed"],
           fstatus["overview"]["throttled"],
           len(fstatus["tickers_filled"]),
           len(fstatus["tickers_still_missing"])))
    # ---- grade history (grades-history.json): after the main file
    # is written, and never allowed to fail the run.
    try:
        write_grades_history(previous_grades, gh_extracted, today)
    except Exception as exc:
        log("ERROR: grade-history step failed (%s); the previous "
            "grades-history.json stays in place." % exc)
    return 0


if __name__ == "__main__":
    if "--grades-only" in sys.argv:
        sys.exit(grades_only_main())
    sys.exit(main())
