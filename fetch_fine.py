"""Fine intraday layers for the Finance chart's longer ranges.

Built by fetch_chart_data.py at the end of its run (the workflow
already runs that script; this module is imported lazily there so
a failure here can never touch the chart files). Writes one small
file per series per rung beside the chart files:

    fine30/<KEY>.json   30-minute bars, the source's last ~60 days
    fine60/<KEY>.json   60-minute bars, the source's last ~730 days
    fine15/<KEY>.json   15-minute bars, the source's last ~60 days
    fine5/<KEY>.json    5-minute bars, the source's last ~60 days,
                        headline markets only (see RUNGS below)

Why these rungs (verified empirically against the Yahoo v8 chart
API on 2026-11-23, the pipeline's own source and user agent):
  - 30m: Yahoo refuses any request whose start is more than 60
    days back ("The requested range must be within the last 60
    days", HTTP 422) — a 59-day pull is the safe full window:
    ~1,243 bars for a liquid stock, ~57 KB in this encoding.
  - 60m: the same wall sits at 730 days — a 729-day pull is the
    safe full window: ~8,211 bars for a liquid stock (~379 KB),
    ~3,477 for a cash index (regular session only — the indexes
    print no extended-hours bars at any interval), ~17,465 for
    BTC-USD, which trades around the clock.
  - 1m and 5m need no rung here: finance-intraday.json already
    carries the last five sessions at 1 minute for the primary
    series, finer than the ladder's 1W rung.

Every run re-pulls each rung's full window and replaces the file
wholesale — the daily file's discipline, no merge state to rot.
A series whose fetch fails keeps its previous file untouched;
a run that builds nothing new leaves every file standing. The
chart treats a missing or stale fine file as "daily bars, as
today" — never an error.

Bars are Yahoo's own with includePrePost, kept exactly as
returned: for US equities that is the 04:00-20:00 ET extended
session (the same window finance-intraday.json carries, shaded
the same way by the chart); the cash indexes return regular-
session bars only; futures, FX and Bitcoin return their full
trading day, matching the daily bars they refine. Volume is
the source's: Yahoo reports 0 outside 09:30-16:00 ET for
equities at every interval (verified 2026-11-23), so a fine
view's volume is the regular session's, as the 1D / 1W views
already say. Bar shape is the intraday file's: epoch seconds
then [open, high, low, close, volume].
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

FINE_SCHEMA = "finance-fine/v1"
HEADERS = {"User-Agent": "Mozilla/5.0 (onealjb93.github.io chart updater)"}
HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]
FETCH_SLEEP = 0.5  # be polite to the endpoint

# span_days stays one day inside Yahoo's verified walls (60 / 730
# days, both strict); keep_days trims a file to its rung's horizon
# so a file can never outgrow the range it serves. The sub-30m
# rungs (15m, 5m) sit under the same 60-day wall as 30m
# (2026-11-24). fine5 is restricted to the headline markets —
# BTC, the two cash indexes, gold — because a 5-minute file for
# each of the 128 series would add ~50 MB of wholesale-replaced
# files to every nightly commit, while the equity series
# already carry a finer layer at tight zooms in
# finance-intraday.json (1-minute, last five sessions). The
# "only" set names page keys; a key absent from the daily
# series is simply not built.
RUNGS = [
    {"interval": "30m", "subdir": "fine30", "span_days": 59,
     "keep_days": 62},
    {"interval": "60m", "subdir": "fine60", "span_days": 729,
     "keep_days": 732},
    {"interval": "15m", "subdir": "fine15", "span_days": 59,
     "keep_days": 62},
    {"interval": "5m", "subdir": "fine5", "span_days": 59,
     "keep_days": 62, "only": {"BTC", "SPX", "IXIC", "GOLD"}},
]


def _noop(msg):
    pass


def fetch_fine_bars(symbol, rung, session, log=_noop):
    """One rung's bars for one symbol: [[ts, o, h, l, c, v]].

    Bars with no close are skipped; a missing open/high/low falls
    back to the close and a missing volume is 0 — the daily and
    intraday fetches' conventions. Raises on failure; the caller
    keeps the previous file.
    """
    now = datetime.now(timezone.utc)
    p2 = int(now.timestamp()) + 300
    p1 = int((now - timedelta(days=rung["span_days"])).timestamp())
    cutoff = p2 - rung["keep_days"] * 86400
    last_exc = None
    data = None
    for host in HOSTS:
        url = "https://%s/v8/finance/chart/%s" % (host, symbol)
        try:
            resp = session.get(
                url,
                params={"period1": p1, "period2": p2,
                        "interval": rung["interval"],
                        "includePrePost": "true",
                        "events": "div,split"},
                headers=HEADERS, timeout=60)
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

    bars = []
    for i, ts in enumerate(stamps):
        close = closes[i] if i < len(closes) else None
        if close is None or close <= 0:
            continue  # no close, no bar
        if ts < cutoff or ts > p2:
            continue  # outside this rung's horizon
        vol = vols[i] if i < len(vols) and vols[i] is not None else 0
        bars.append([int(ts), round(num(opens, i, float(close)), 4),
                     round(num(highs, i, float(close)), 4),
                     round(num(lows, i, float(close)), 4),
                     round(float(close), 4), int(vol)])
    bars.sort(key=lambda b: b[0])
    return bars


def _write_series_file(path, doc):
    tmp = path + ".tmp"
    with open(tmp, "w") as fh:
        json.dump(doc, fh, separators=(",", ":"))
    os.replace(tmp, path)


def build_fine_files(d_series, out_dir, log=_noop, session=None,
                     only_keys=None):
    """Write fine30/ + fine60/ files for every daily series.

    d_series is fetch_chart_data's daily series dict (page key ->
    {"name", "symbol", ...}). Failure-isolated per series and
    rung: a failed fetch leaves that file untouched and is logged.
    Returns {subdir: (written, kept, failed)} counts.
    """
    if session is None:
        session = requests.Session()
    counts = {}
    for rung in RUNGS:
        sub = os.path.join(out_dir, rung["subdir"])
        os.makedirs(sub, exist_ok=True)
        written, kept, failed = 0, 0, []
        rung_only = rung.get("only")
        keys = [k for k in d_series
                if (only_keys is None or k in only_keys)
                and (rung_only is None or k in rung_only)]
        for key in keys:
            meta = d_series[key]
            symbol = meta.get("symbol") or key
            path = os.path.join(sub, key + ".json")
            try:
                bars = fetch_fine_bars(symbol, rung, session, log)
                if not bars:
                    raise ValueError("no bars returned")
            except Exception as exc:
                failed.append(key)
                if os.path.exists(path):
                    kept += 1
                    log("  fine %s FAILED for %s (%s) — keeping "
                        "the previous file." % (rung["interval"], key, exc))
                else:
                    log("  fine %s FAILED for %s (%s) — no file; "
                        "the chart stays on daily bars for it."
                        % (rung["interval"], key, exc))
                continue
            # Completeness guard (2026-11-23, the Bitcoin rule):
            # a fresh pull that ends before the file it would
            # replace, collapses to a fraction of its bar count,
            # or ends days ago is a truncated record — keep the
            # previous file and count the rung as failed, loudly.
            if os.path.exists(path):
                try:
                    with open(path) as fh:
                        prev_bars = json.load(fh).get("bars") or []
                except Exception:
                    prev_bars = []
                guard = None
                if prev_bars:
                    if bars[-1][0] < prev_bars[-1][0]:
                        guard = ("ends %s, before the previous "
                                 "file's %s" % (bars[-1][0],
                                                prev_bars[-1][0]))
                    elif len(bars) < 0.5 * len(prev_bars):
                        guard = ("collapsed %d -> %d bars"
                                 % (len(prev_bars), len(bars)))
                if guard is None and \
                        time.time() - bars[-1][0] > 4 * 86400:
                    guard = "last bar is more than 4 days old"
                if guard is not None:
                    failed.append(key)
                    log("  fine GUARD %s %s: %s — keeping the "
                        "previous file."
                        % (rung["interval"], key, guard))
                    continue
            last_et = datetime.fromtimestamp(
                bars[-1][0], tz=timezone.utc).astimezone(ET)
            doc = {
                "schema": FINE_SCHEMA,
                "key": key,
                "symbol": symbol,
                "name": meta.get("name") or key,
                "interval": rung["interval"],
                "generated_at": datetime.now(timezone.utc).strftime(
                    "%Y-%m-%dT%H:%M:%SZ"),
                "source": "Yahoo Finance v8 chart API, %s bars with "
                          "includePrePost (extended hours)"
                          % rung["interval"],
                "note": "Display layer only — the chart's "
                        "indicators, signals and readout compute "
                        "from the daily file. A snapshot, refreshed "
                        "weekday evenings. Extended-hours volume "
                        "is not carried by the source for equities "
                        "(it reports 0 outside 09:30-16:00 ET).",
                "through_et": last_et.date().isoformat(),
                "bars": bars,
            }
            _write_series_file(path, doc)
            written += 1
            log("  fine %s %s: %d bars through %s ET"
                % (rung["interval"], key, len(bars), doc["through_et"]))
            time.sleep(FETCH_SLEEP)
        counts[rung["subdir"]] = (written, kept, failed)
        log("Fine %s: wrote %d, kept %d previous, failed %d%s."
            % (rung["interval"], written, kept, len(failed),
               " (" + ", ".join(failed) + ")" if failed else ""))
    return counts


if __name__ == "__main__":
    # Standalone run: build from a finance-chart-daily.json (path
    # as argv[1], or ./finance-chart-daily.json) into argv[2] (or
    # the same directory), optionally for the keys in argv[3:].
    # Production never runs this — the hook in fetch_chart_data.py
    # imports build_fine_files.
    import sys
    daily_path = sys.argv[1] if len(sys.argv) > 1 else "finance-chart-daily.json"
    out_dir = sys.argv[2] if len(sys.argv) > 2 else os.path.dirname(
        os.path.abspath(daily_path))
    only = set(sys.argv[3:]) or None
    with open(daily_path) as fh:
        daily = json.load(fh)
    counts = build_fine_files(daily["series"], out_dir,
                              log=lambda m: print(m, flush=True),
                              only_keys=only)
    print(counts)
