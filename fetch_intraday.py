"""Intraday sessions for the Finance page's 1D / 1W chart views.

Built by fetch_chart_data.py at the end of its run (the workflow
already runs that script; this module is imported lazily there so
a failure here can never touch the chart files). Writes
finance-intraday.json beside the chart files:

  For each of the chart's primary series — Johnny's 19 stocks,
  the four benchmarks (SPX, IXIC, GOLD, BTC) and the band's 12
  instruments — the last five trading sessions of 1-minute bars
  inside the US extended session, 04:00-20:00 America/New_York,
  pre-market and after-hours included (Yahoo v8 with
  includePrePost). The chart's Daily 1D view draws the most
  recent session in this file; 1W draws all five.

Why 1-minute bars: at 5 minutes Yahoo's extended-hours bars stop
at 19:00 (proven on NVDA, 2026-11-23: the 5m series ends at the
18:55 bar while the 1m series runs to 19:59). Only the 1m series
covers the session to 20:00.

What the source does and does not carry, proven the same day:
  - Prices: real pre/post trades, every liquid name checked.
  - Volume: Yahoo reports 0 for extended-hours bars at both 1m
    and 5m — the volume in this file is the regular session's
    (09:30-16:00) only, and the chart says so.
  - The cash indexes (^GSPC, ^IXIC) print no extended-hours bars
    at all: their sessions here are the regular session only.
  - Futures, FX and Bitcoin trade around the clock; this file
    keeps only their 04:00-20:00 ET slice, so every series in
    the file is the same "US session day" the chart draws.

Yahoo serves only the last ~7 days of 1-minute bars, so each run
merges its pull into the previous file (new bars win) before
trimming back to the last five sessions — the same keep-what-
you-have discipline as the daily file: a series whose fetch
fails keeps its previous sessions, and a run that builds
nothing leaves the previous file untouched.

The file is a snapshot of completed (or, on a weekday evening,
still-forming) sessions — never a live feed. The chart labels
every intraday view with its session date.
"""

import json
import os
import time
from datetime import datetime, timedelta, timezone

import requests

try:
    from zoneinfo import ZoneInfo
    ET = ZoneInfo("America/New_York")
except Exception:  # no tzdata on the runner: fixed EST, and say so
    from datetime import timezone as _tz
    ET = _tz(timedelta(hours=-5))

INTRA_OUT_FILE = "finance-intraday.json"
SCHEMA = "finance-intraday/v1"
HEADERS = {"User-Agent": "Mozilla/5.0 (onealjb93.github.io chart updater)"}
HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]

# The chart's primary set: Johnny's 19, the four benchmarks the
# indicator also runs on, and the band's 12 instruments. The
# Nasdaq-100 long tail and the VIX stay on the daily views —
# their 1D / 1W buttons fall back to daily bars, as designed.
PRIMARY_KEYS = {
    "SPX", "IXIC", "GOLD", "BTC",
    "GOOGL", "ASST", "CIFR", "SPCX", "NBIS", "IREN", "AAOI",
    "NVDA", "AMD", "PLTR", "MU", "TSLA", "MSTR", "TSM", "LLY",
    "WM", "COST", "JPM", "WMT",
    "DOW", "RUT", "TNX", "DOLLAR", "EURO", "SILVER", "COPPER",
    "OIL", "BRENT", "NATGAS", "CORN", "WHEAT",
}
SESSIONS_KEPT = 5
WINDOW_START_MIN = 4 * 60    # 04:00 ET
WINDOW_END_MIN = 20 * 60     # 20:00 ET (exclusive)
FETCH_DAYS_BACK = 6.9        # Yahoo serves ~7 days of 1m bars
FETCH_SLEEP = 0.5            # be polite to the endpoint


def _noop(msg):
    pass


def fetch_intraday_bars(symbol, session, log=_noop):
    """1-minute bars for one symbol: {et_date_iso: [[ts, o, h, l, c, v]]}.

    Only bars inside 04:00-20:00 ET are kept. Bars with no close
    are skipped; a missing open/high/low falls back to the close
    and a missing volume is 0 — the daily fetch's conventions.
    """
    now = datetime.now(timezone.utc)
    p2 = int(now.timestamp()) + 300
    p1 = int((now - timedelta(days=FETCH_DAYS_BACK)).timestamp())
    last_exc = None
    data = None
    for host in HOSTS:
        url = "https://%s/v8/finance/chart/%s" % (host, symbol)
        try:
            resp = session.get(
                url,
                params={"period1": p1, "period2": p2,
                        "interval": "1m", "includePrePost": "true",
                        "events": "div,split"},
                headers=HEADERS, timeout=30)
            resp.raise_for_status()
            data = resp.json()
        except Exception as exc:  # try the mirror host before giving up
            last_exc = exc
            continue
        break
    if data is None:
        raise last_exc if last_exc else ValueError("no host answered")
    result = (data.get("chart") or {}).get("result") or []
    if not result:
        err = (data.get("chart") or {}).get("error") or {}
        raise ValueError("no chart result: %s" % err)
    quote = result[0].get("indicators", {}).get("quote", [{}])[0]
    stamps = result[0].get("timestamp") or []
    opens = quote.get("open") or []
    highs = quote.get("high") or []
    lows = quote.get("low") or []
    closes = quote.get("close") or []
    vols = quote.get("volume") or []

    def num(arr, i, fallback):
        v = arr[i] if i < len(arr) else None
        return float(v) if v is not None else fallback

    by_date = {}
    for i, ts in enumerate(stamps):
        close = closes[i] if i < len(closes) else None
        if close is None or close <= 0:
            continue  # no close, no bar
        dt = datetime.fromtimestamp(ts, tz=timezone.utc).astimezone(ET)
        mins = dt.hour * 60 + dt.minute
        if mins < WINDOW_START_MIN or mins >= WINDOW_END_MIN:
            continue  # outside the US extended session this file carries
        vol = vols[i] if i < len(vols) and vols[i] is not None else 0
        bar = [int(ts), round(num(opens, i, float(close)), 4),
               round(num(highs, i, float(close)), 4),
               round(num(lows, i, float(close)), 4),
               round(float(close), 4), int(vol)]
        by_date.setdefault(dt.date().isoformat(), []).append(bar)
    for bars in by_date.values():
        bars.sort(key=lambda b: b[0])
    return by_date


def _merge_sessions(previous_entry, fresh_by_date):
    """Merge a fresh pull into a series' stored sessions.

    Bars are keyed by timestamp (new wins); the result is the
    last SESSIONS_KEPT session dates, oldest first, each with its
    coverage line: [first "HH:MM", last "HH:MM", bar count] in ET.
    """
    by_date = {}
    if previous_entry:
        for sess in previous_entry.get("sessions") or []:
            by_date[sess["date"]] = {b[0]: b for b in sess["bars"]}
    for d, bars in (fresh_by_date or {}).items():
        slot = by_date.setdefault(d, {})
        for b in bars:
            slot[b[0]] = b
    dates = sorted(d for d, slot in by_date.items() if slot)
    dates = dates[-SESSIONS_KEPT:]
    sessions, coverage = [], {}
    for d in dates:
        bars = [by_date[d][ts] for ts in sorted(by_date[d])]
        sessions.append({"date": d, "bars": bars})

        def hhmm(ts):
            dt = datetime.fromtimestamp(ts, tz=timezone.utc).astimezone(ET)
            return "%02d:%02d" % (dt.hour, dt.minute)

        coverage[d] = [hhmm(bars[0][0]), hhmm(bars[-1][0]), len(bars)]
    return sessions, coverage


def build_intraday_file(d_series, out_dir, log=_noop, session=None):
    """Write finance-intraday.json into out_dir. Returns True if written.

    d_series is fetch_chart_data's daily series dict (page key ->
    {"name", "symbol", ...}); only PRIMARY_KEYS are pulled.
    Failure-isolated per series: a failed fetch keeps the series'
    previous sessions; if nothing at all could be built and no
    previous file exists, nothing is written.
    """
    if session is None:
        session = requests.Session()
    out_path = os.path.join(out_dir, INTRA_OUT_FILE)
    previous = None
    if os.path.exists(out_path):
        try:
            with open(out_path) as fh:
                previous = json.load(fh)
        except Exception as exc:
            log("  intraday: previous %s unreadable (%s) — rebuilding "
                "from the fresh pull alone." % (INTRA_OUT_FILE, exc))
            previous = None
    prev_series = (previous or {}).get("series") or {}

    keys = [k for k in d_series if k in PRIMARY_KEYS]
    missing = sorted(PRIMARY_KEYS - set(d_series))
    if missing:
        log("  intraday: %d primary keys absent from the daily series "
            "(%s) — skipped." % (len(missing), ", ".join(missing)))
    series, failed, kept = {}, [], 0
    for key in keys:
        entry_meta = d_series[key]
        symbol = entry_meta.get("symbol") or key
        try:
            fresh = fetch_intraday_bars(symbol, session, log)
            if not fresh:
                raise ValueError("no bars inside the session window")
        except Exception as exc:
            failed.append(key)
            if key in prev_series:
                kept += 1
                series[key] = prev_series[key]
                log("  intraday FAILED for %s (%s) — keeping its "
                    "previous sessions." % (key, exc))
            else:
                log("  intraday FAILED for %s (%s) — no previous "
                    "sessions to keep; the chart falls back to daily "
                    "bars for it." % (key, exc))
            continue
        sessions, coverage = _merge_sessions(prev_series.get(key), fresh)
        series[key] = {"name": entry_meta.get("name") or key,
                       "symbol": symbol,
                       "sessions": sessions, "coverage": coverage}
        last = sessions[-1]
        log("  intraday %s: %d sessions, latest %s (%d bars, %s-%s ET)"
            % (key, len(sessions), last["date"],
               len(last["bars"]), coverage[last["date"]][0],
               coverage[last["date"]][1]))
        time.sleep(FETCH_SLEEP)

    if not series:
        log("  intraday: nothing built and no previous file — "
            "writing nothing; the chart's 1D / 1W stay on daily bars.")
        return False
    # Honesty guard (2026-11-23): if every series' latest session
    # is byte-for-byte the previous file's (same date, same bar
    # count) — every fetch failed, or the market was closed and
    # the pull returned the same sessions — do not rewrite the
    # file with a fresh generated_at over old data. The previous
    # file stands, timestamp and all, so staleness stays visible.
    def _sig(srs):
        out = {}
        for k, v in srs.items():
            sess = v.get("sessions") or []
            if sess:
                out[k] = (sess[-1]["date"], len(sess[-1]["bars"]))
        return out
    if previous is not None and _sig(series) == _sig(prev_series):
        log("  intraday: no series advanced past the previous "
            "file — leaving it untouched rather than restamp "
            "old sessions as fresh.")
        return False
    through = max(s["sessions"][-1]["date"] for s in series.values())
    doc = {
        "schema": SCHEMA,
        "generated_at": datetime.now(timezone.utc).strftime(
            "%Y-%m-%dT%H:%M:%SZ"),
        "source": "Yahoo Finance v8 chart API, 1-minute bars with "
                  "includePrePost (extended hours)",
        "interval": "1m",
        "window": "04:00-20:00 America/New_York",
        "note": "The last five sessions in this file when it was "
                "built — a snapshot, refreshed weekday evenings, "
                "never a live feed. Extended-hours volume is not "
                "carried by the source (it reports 0 outside "
                "09:30-16:00), so volume here is the regular "
                "session's. The cash indexes print no extended-"
                "hours bars: their sessions are 09:30-16:00 only.",
        "through": through,
        "series": series,
    }
    tmp = out_path + ".tmp"
    with open(tmp, "w") as fh:
        json.dump(doc, fh, separators=(",", ":"))
    os.replace(tmp, out_path)
    log("Wrote %s (%d instruments, through %s%s)."
        % (out_path, len(series), through,
           ", failed: " + ", ".join(failed) if failed else ""))
    return True


if __name__ == "__main__":
    # Standalone test run: build from a finance-chart-daily.json
    # (path as argv[1], or ./finance-chart-daily.json) into argv[2]
    # (or the same directory). Production never runs this — the
    # hook in fetch_chart_data.py imports build_intraday_file.
    import sys
    daily_path = sys.argv[1] if len(sys.argv) > 1 else "finance-chart-daily.json"
    out_dir = sys.argv[2] if len(sys.argv) > 2 else os.path.dirname(
        os.path.abspath(daily_path))
    with open(daily_path) as fh:
        daily = json.load(fh)
    ok = build_intraday_file(daily["series"], out_dir,
                             log=lambda m: print(m, flush=True))
    sys.exit(0 if ok else 1)
