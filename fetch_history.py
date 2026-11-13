"""Fetch weekly adjusted closes from Yahoo Finance v8 chart API.

One file, one purpose: build finance-history.json for the portfolio backtest.
Yahoo's adjusted close folds dividends and splits back into the price, so
returns computed from it are TOTAL return (dividends reinvested). That is the
honest basis for a backtest that includes income securities (STRC ~12% and
SATS 15% dividend rates) — a price-only series would show them near 0%.

Sources: https://query1.finance.yahoo.com/v8/finance/chart/<SYMBOL>
  ?range=10y&interval=1wk&events=div,split  (no key, no auth from most hosts)
Stooq is kept as a documented alternative for price-only closes, but it is
NOT used here: it serves a JS challenge to non-browser clients, and its
closes are unadjusted, which would misstate total return for the preferreds.

Honesty rules (same as update_finance.py):
- A missing series is null, never a guess. A failed fetch leaves the ticker
  out of the JSON with a null entry and a logged reason.
- SATS: the ticker belonged to EchoStar until 2026-06-24, when EchoStar
  changed to ECHO. Yahoo's SATS series is cut to dates >= 2026-06-24 so no
  EchoStar price ever enters the Strive series.
- Nothing is written until every symbol has been attempted.
"""

import json
import os
import sys
import time
from datetime import date, datetime, timezone

import requests

# (symbol for Yahoo, kind, display name, stated annual dividend rate % or None)
SERIES = [
    ("GOOGL", "stock", "Alphabet / Google", None),
    ("ASST", "stock", "Strive (Asset Series)", None),
    ("CIFR", "stock", "Cipher Mining", None),
    ("SPCX", "stock", "SpaceX", None),
    ("NBIS", "stock", "Nebius Group", None),
    ("IREN", "stock", "Iris Energy", None),
    ("AAOI", "stock", "Applied Optoelectronics", None),
    ("NVDA", "stock", "NVIDIA", None),
    ("AMD", "stock", "AMD", None),
    ("PLTR", "stock", "Palantir", None),
    ("MU", "stock", "Micron Technology", None),
    ("TSLA", "stock", "Tesla", None),
    ("MSTR", "stock", "MicroStrategy / Strategy", None),
    ("TSM", "stock", "Taiwan Semiconductor", None),
    ("LLY", "stock", "Eli Lilly", None),
    ("WM", "stock", "Waste Management", None),
    ("COST", "stock", "Costco", None),
    ("JPM", "stock", "JPMorgan Chase", None),
    ("WMT", "stock", "Walmart", None),
    ("STRC", "preferred", "Strategy Stretch Preferred", 12.0),
    ("SATS", "preferred", "Strive 15% Series A Preferred", 15.0),
    ("BTC-USD", "crypto", "Bitcoin", None),
    ("QQQ", "etf", "Invesco QQQ Trust", None),
    ("VOO", "etf", "Vanguard S&P 500 ETF", None),
    ("SPY", "etf", "SPDR S&P 500 ETF", None),
]

# SATS belonged to EchoStar before this date (EchoStar -> ECHO 2026-06-24).
# Any SATS price before it is EchoStar's, never Strive's.
SATS_CUTOFF = "2026-06-24"

OUT_FILE = "finance-history.json"
HEADERS = {"User-Agent": "Mozilla/5.0 (onealjb93.github.io backtest updater)"}


def log(msg):
    print(msg, flush=True)


def fetch_yahoo(symbol):
    """Weekly adjusted closes: list of (date, adjclose), oldest first."""
    url = "https://query1.finance.yahoo.com/v8/finance/chart/%s" % symbol
    resp = requests.get(
        url,
        params={"range": "10y", "interval": "1wk", "events": "div,split"},
        headers=HEADERS,
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()
    result = (data.get("chart") or {}).get("result") or []
    if not result:
        err = (data.get("chart") or {}).get("error") or {}
        raise ValueError("no chart result: %s" % err)
    quote = result[0].get("indicators", {}).get("quote", [{}])[0]
    adj = result[0].get("indicators", {}).get("adjclose", [{}])[0]
    stamps = result[0].get("timestamp") or []
    closes = quote.get("close") or []
    adjcloses = (adj or {}).get("adjclose") or []
    rows = []
    for i, ts in enumerate(stamps):
        # Prefer adjusted close (total return); fall back to raw close.
        price = None
        if i < len(adjcloses) and adjcloses[i] is not None:
            price = adjcloses[i]
        elif i < len(closes) and closes[i] is not None:
            price = closes[i]
        if price is None or price <= 0:
            continue
        d = datetime.fromtimestamp(ts, tz=timezone.utc).date().isoformat()
        rows.append((d, round(float(price), 4)))
    rows.sort()
    return rows


def main():
    out_path = sys.argv[1] if len(sys.argv) > 1 else OUT_FILE
    today = date.today().isoformat()
    series = {}
    failures = []
    for symbol, kind, name, div_rate in SERIES:
        log("=== %s ===" % symbol)
        try:
            rows = fetch_yahoo(symbol)
        except Exception as exc:
            log("  FAILED: %s" % exc)
            series[symbol] = {
                "name": name, "kind": kind, "dividend_rate": div_rate,
                "first_date": None, "prices": None,
                "error": "fetch failed: %s" % exc,
            }
            failures.append(symbol)
            time.sleep(1)
            continue
        if symbol == "SATS":
            before = len(rows)
            rows = [r for r in rows if r[0] >= SATS_CUTOFF]
            log("  SATS: cut %d pre-reassignment rows (EchoStar); %d Strive rows kept"
                % (before - len(rows), len(rows)))
        if not rows:
            log("  no usable rows for %s" % symbol)
            series[symbol] = {
                "name": name, "kind": kind, "dividend_rate": div_rate,
                "first_date": None, "prices": None,
                "error": "no usable weekly closes returned",
            }
            failures.append(symbol)
            time.sleep(1)
            continue
        log("  %d weekly points, %s .. %s, last adj close $%.2f"
            % (len(rows), rows[0][0], rows[-1][0], rows[-1][1]))
        series[symbol] = {
            "name": name,
            "kind": kind,
            "dividend_rate": div_rate,
            "first_date": rows[0][0],
            "prices": rows,
        }
        time.sleep(1)  # be polite to the endpoint

    output = {
        "last_updated": today,
        "source": "Yahoo Finance v8 chart API (query1.finance.yahoo.com), weekly adjusted closes",
        "return_basis": "total return — adjusted closes fold dividends and splits back in, so returns include reinvested dividends. QQQ/VOO/SPY likewise include their dividends.",
        "series": series,
    }
    if failures:
        # A failed fetch must never overwrite a good file with nulls: keep
        # the previous finance-history.json in place and fail the run so the
        # workflow does not commit a degraded file.
        log("FAILURES for %s — leaving the previous %s untouched."
            % (", ".join(failures), out_path))
        return 1
    tmp_path = out_path + ".tmp"
    with open(tmp_path, "w") as fh:
        json.dump(output, fh, separators=(",", ":"))
    os.replace(tmp_path, out_path)
    log("Wrote %s (%d series, 0 failures)." % (out_path, len(series)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
