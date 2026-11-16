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

TICKERS = [
    "GOOGL", "ASST", "CIFR", "SPCX", "NBIS", "IREN", "AAOI",
    "NVDA", "AMD", "PLTR", "MU", "TSLA", "MSTR", "TSM",
    "LLY", "WM", "COST", "JPM", "WMT",
]

DATA_FILE = "finance-data.json"
CIK_MAP_FILE = "cik_map.json"
OVERVIEW_MAX_PER_RUN = 4
FUNDAMENTALS_STALE_DAYS = 7

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
    """All (end, value, form) entries for the first tag that has data.

    tag_candidates is a list of (taxonomy, tag) pairs, tried in order, so
    us-gaap is preferred and ifrs-full is the fallback for foreign filers.
    """
    for taxonomy, tag in tag_candidates:
        try:
            units = facts["facts"][taxonomy][tag]["units"]
        except KeyError:
            continue
        for unit_values in units.values():
            entries = [
                (e["end"], e["val"], e.get("form", ""))
                for e in unit_values
                if "end" in e and "val" in e
            ]
            if entries:
                return sorted(entries)
    return []


def latest_value(entries):
    """Most recent value by period end (instant tags: shares, equity, debt)."""
    if not entries:
        return None, None
    end, val, form = entries[-1]
    return parse_float(val), end


def latest_quarterly(entries):
    """Most recent 10-Q value, or None."""
    quarters = [e for e in entries if e[2] == "10-Q"]
    if not quarters:
        return None, None, None
    end, val, _ = quarters[-1]
    prior = [e for e in quarters if e[0] == _shift_year(end)]
    prior_val = parse_float(prior[-1][1]) if prior else None
    return parse_float(val), prior_val, end


def latest_annual(entries):
    """Most recent 10-K value plus the prior year's, or None."""
    annuals = [e for e in entries if e[2] == "10-K"]
    if not annuals:
        return None, None, None
    end, val, _ = annuals[-1]
    prior_val = parse_float(annuals[-2][1]) if len(annuals) >= 2 else None
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

def main():
    api_key = os.environ.get("API_KEY")
    if not api_key:
        log("ERROR: API_KEY is not set in the environment. Nothing was written.")
        return 2

    try:
        with open(DATA_FILE) as fh:
            previous = {s["ticker"]: s for s in json.load(fh).get("stocks", [])}
    except (OSError, ValueError):
        previous = {}

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

        if facts is not None:
            share_entries = fact_entries(facts, [
                ("us-gaap", "CommonStockSharesOutstanding"),
                ("us-gaap", "WeightedAverageNumberOfDilutedSharesOutstanding"),
                ("ifrs-full", "IssuedCapital"),
            ])
            shares, _share_end = latest_value(share_entries)

        if price is not None and shares:
            mcap_b = price * shares / 1e9
            record["mcap"] = round(mcap_b, 2)
            record["mcap_str"] = money_str(mcap_b)
        else:
            record["mcap"] = None
            record["mcap_str"] = None
            if price is not None:
                log("  no share count for %s; market cap null" % symbol)

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
            eps_entries = fact_entries(facts, [
                ("us-gaap", "EarningsPerShareDiluted"),
                ("ifrs-full", "DilutedEarningsPerShare"),
            ])

            ttm_rev, rev_period = ttm_value(rev_entries)
            ttm_ni, _ni_period = ttm_value(ni_entries)
            ttm_eps, _eps_period = ttm_value(eps_entries)
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
            peg = None
            if price is not None and ttm_eps and growth:
                pe = price / ttm_eps
                peg = round(pe / growth, 2)

            record["peg"] = peg
            record["growth"] = growth
            record["debt"] = debt_to_equity
            record["roe"] = roe
            record["margin"] = margin
            record["analyst_target"] = None  # filled from OVERVIEW below, if any
            record["fundamentals_as_of"] = today
            record["fundamentals_source"] = "SEC EDGAR filings"
            record["fiscal_period"] = (
                "10-Q/10-K ended %s" % rev_period if rev_period else None
            )
        else:
            # Not due (or no EDGAR data): carry the previous fundamentals.
            for key in ("peg", "growth", "debt", "roe", "margin",
                        "analyst_target", "fundamentals_as_of",
                        "fundamentals_source", "fiscal_period"):
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
    output = {"last_updated": today, "fundamentals_status": fstatus,
              "stocks": stocks}
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
    return 0


if __name__ == "__main__":
    sys.exit(main())
