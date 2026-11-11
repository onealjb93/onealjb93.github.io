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
  (companyfacts, no key). Cross-checked against OVERVIEW MarketCapitalization
  where an OVERVIEW call was made.
- Fundamentals (PEG, growth, debt, ROE, margin): SEC EDGAR companyfacts
  (us-gaap tags first, ifrs-full for foreign filers), refreshed weekly on
  rotation; Alpha Vantage OVERVIEW (max 4 calls/day, only for tickers whose
  fundamentals are > 7 days stale) for PEGRatio, AnalystTargetPrice and
  cross-checks. 19 quotes + at most 4 OVERVIEWs = 23 calls/day max.
- Momentum: 3-month % price return computed from Stooq daily closes (free,
  no key): (latest close / close 63 trading days earlier - 1) x 100.
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
- If any Alpha Vantage response carries a rate-limit "Note", the run stops
  immediately with a non-zero exit and writes nothing (no partial data).
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
OVERVIEW_MAX_PER_RUN = 4
FUNDAMENTALS_STALE_DAYS = 7

EDGAR_HEADERS = {
    "User-Agent": "onealjb93.github.io market-data updater (https://onealjb93.github.io/)",
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
    pass


def alpha_vantage(api_key, function, symbol):
    """One Alpha Vantage call. Raises RateLimited on a throttling Note."""
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
        # Usage notice (e.g. demo key / premium endpoint): treat as failure.
        raise ValueError(
            "Alpha Vantage info (%s %s): %s" % (function, symbol, data["Information"])
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
    """Returns the OVERVIEW dict, or None on failure. Rate limit raises."""
    try:
        data = alpha_vantage(api_key, "OVERVIEW", symbol)
    except RateLimited:
        raise
    except Exception as exc:
        log("  OVERVIEW failed for %s: %s" % (symbol, exc))
        return None
    if not data or not data.get("Symbol"):
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


def fetch_companyfacts(cik):
    resp = requests.get(
        "https://data.sec.gov/api/xbrl/companyfacts/CIK%s.json" % cik,
        headers=EDGAR_HEADERS,
        timeout=60,
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

    try:
        cik_map = fetch_cik_map()
    except Exception as exc:
        log("ERROR: could not fetch SEC ticker->CIK map: %s" % exc)
        return 1

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
        if cik:
            try:
                facts = fetch_companyfacts(cik)
            except Exception as exc:
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
        if symbol in due and overview_calls < OVERVIEW_MAX_PER_RUN:
            overview_calls += 1
            try:
                ov = fetch_overview(api_key, symbol)
            except RateLimited as exc:
                log("ERROR: %s" % exc)
                log("Stopping without writing: partial data would be misleading.")
                return 1
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
                if record.get("fundamentals_source") == "SEC EDGAR filings":
                    record["fundamentals_source"] = (
                        "SEC EDGAR filings + Alpha Vantage OVERVIEW"
                    )

        stocks.append(record)

    output = {"last_updated": today, "stocks": stocks}
    with open(DATA_FILE, "w") as fh:
        json.dump(output, fh, indent=2)
    log("Wrote %s (%d tickers, %d OVERVIEW calls)."
        % (DATA_FILE, len(stocks), overview_calls))
    return 0


if __name__ == "__main__":
    sys.exit(main())
