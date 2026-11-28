#!/usr/bin/env python3
"""Step 2 of the market-data automation: verify correctness
BEFORE anything publishes (Johnny's rule, 2026-11-24).

Step 1 (the builders) produces the files; this step runs in the
same workflow run, after every builder and before the commit
step, and the commit is gated on it: exit 1 here means no
commit, yesterday's good data stays live, and the run fails
loudly. Internal consistency alone cannot catch a wrong feed,
so alongside recomputation this suite cross-checks a sample of
prices against independent sources.

Checks (each failure prints one plain line and fails the run):
  CALENDAR   finance-chart-daily.json's `through` is the last
             completed US session (weekend/holiday aware), and
             every headline series ends there — with one
             exception: BTC trades every calendar day, so
             `through` (the max over all series) may sit past
             the session when every day inside the lead is a
             non-session day; then session-bound series are
             judged against the session date and BTC against
             `through` itself. A lead spanning a session day
             still fails — that is a missing session, not a
             holiday.
  BARS       per series: dates strictly increasing, OHLC
             ordered, closes positive, no unexplained jump in
             the last bar, last close in line with its own
             trailing history.
  DOTS       buy/sell/score_buys are sorted, unique, disjoint,
             and every dot date is a bar date.
  RECOMPUTE  the indicator is recomputed from the built bars +
             P/E arrays + VIX with the builder's own functions
             (imported from fetch_chart_data.py beside this
             file): exact equality for ordinary series; the
             earnings universe's documented subset relations
             (B1 unions buys in, S4/R2 veto sells out); the
             one-run P/E carry reproduced from the previous
             committed file when git can supply it.
  BTC        btc-state.json: headline score = the mean of its
             four parts; band agrees with the 7.79 / 92.91
             thresholds; score_series and spiral closes are
             date-aligned (the page maps dots by date — a
             one-day shift here is dots on wrong days).
  RUNGS      every fine file (fine5/15/30/60) agrees with the
             daily file: same through date, fresh stamp,
             increasing timestamps.
  CROSSCHECK latest closes against independent sources,
             date-matched: SPX vs FRED SP500 (0.35%), IXIC vs
             FRED NASDAQCOM (0.35%), VIX vs FRED VIXCLS (1.0%),
             BTC vs Coinbase daily candles (1.0%), GOLD vs the
             GLD ETF's daily returns via Nasdaq (1.5 percentage
             points per day — FRED's LBMA fix series no longer
             exists, and futures-vs-ETF LEVELS are not
             comparable, but their daily moves must track),
             and a rotating sample of 8 tickers vs Nasdaq
             official history (0.5%). FRED and Nasdaq matched
             Yahoo to the penny on the calibration day
             (2026-11-24); the tolerances sit far above vendor
             noise and far below any wrong-symbol or
             wrong-feed error.
             FALLBACK (Johnny, 2026-11-26): if — and only if —
             a FRED index leg cannot be reached after its
             retries, that leg falls back to the index's own
             publisher: SPX and VIX to CBOE's published daily
             index prices, IXIC to Nasdaq's official index
             history (COMP). Same tolerances, same comparison;
             the fallback sources are independent of Yahoo
             (the builders' feed) and matched the FRED-verified
             closes to the penny on the calibration day. A leg
             verified by fallback says so loudly in the log
             and in verification-report.json; if the fallback
             also fails or disagrees, the leg still fails.
             Any other source that cannot be reached after
             retries fails its leg loudly — an unchecked
             night is not a silent night.
  HOLIDAY    (Johnny, 2026-11-26): when the run date is not
             an NYSE session day, the intraday file and the
             BTC/VIX fine rungs may sit exactly one calendar
             day ahead of the daily through — BTC trades
             through the holiday and the VIX rung stamps
             follow the intraday build, while the daily file
             correctly ends at the last session. Every other
             bound is unchanged: on session days the equality
             is exact, a lead of two days fails, a lag fails,
             and any other series ahead of the daily through
             fails.
             DAILY LEAD (2026-11-28): the same shape inside the
             daily file itself — on the Thanksgiving 2026 run
             the daily `through` itself was the holiday (BTC's
             bar), and the strict session equality failed a
             correct build 95 ways and blocked the publish.
             The daily through may now lead the last session
             only over non-session days (see CALENDAR), and
             the intraday/rungs/cross-check anchors follow the
             session date on such a run.

Usage (workflow):  python verify_market_data.py
Local/tests:       --dir DIR (artifact directory; default cwd)
                   --prev PATH (previous daily file for the
                     P/E carry; default: git show HEAD:)
                   --allow-partial-rungs (test fixtures only)
                   --skip-crosscheck (fixture runs only)
Exit 0 = verified. Exit 1 = failures printed, one per line.
"""

import csv
import io
import json
import os
import subprocess
import sys
import time
import urllib.request
from datetime import date, datetime, timedelta, timezone

try:
    from zoneinfo import ZoneInfo
    ET = ZoneInfo("America/New_York")
except Exception:  # no tzdata: fixed EST, the builders' own fallback
    from datetime import timezone as _tz
    ET = _tz(timedelta(hours=-5))

# ------------------------------------------------------------- calendar
# NYSE full-day closures. Early closes still trade, so only
# full closures belong here.
NYSE_HOLIDAYS = {
    2025: ["01-01", "01-20", "02-17", "04-18", "05-26", "06-19",
           "07-04", "09-01", "11-27", "12-25"],
    2026: ["01-01", "01-19", "02-16", "04-03", "05-25", "06-19",
           "07-03", "09-07", "11-26", "12-25"],
    2027: ["01-01", "01-18", "02-15", "03-26", "05-31", "06-18",
           "07-05", "09-06", "11-25", "12-24"],
    2028: ["01-17", "02-21", "04-14", "05-29", "06-19", "07-04",
           "09-04", "11-23", "12-25"],
}
_HOLIDAY_SET = {("%d-%s" % (y, md)) for y, mds in NYSE_HOLIDAYS.items()
                for md in mds}


def is_session(day):
    return day.weekday() < 5 and day.isoformat() not in _HOLIDAY_SET


def last_completed_session(now_et):
    """The last US session whose 16:00 ET close is complete."""
    day = now_et.date()
    if is_session(day) and now_et.time() >= datetime.min.time().replace(hour=16):
        return day
    day -= timedelta(days=1)
    while not is_session(day):
        day -= timedelta(days=1)
    return day


def prev_session(day):
    day -= timedelta(days=1)
    while not is_session(day):
        day -= timedelta(days=1)
    return day


def sessions_between(a, b):
    """Session days in (a, b]; negative if b < a."""
    if a == b:
        return 0
    if b < a:
        return -sessions_between(b, a)
    n, day = 0, a
    while day < b:
        day += timedelta(days=1)
        if is_session(day):
            n += 1
    return n


# ------------------------------------------------------------- helpers
def d(iso):
    return date.fromisoformat(str(iso)[:10])


class Suite:
    def __init__(self):
        self.failures = []
        self.notes = []

    def fail(self, line):
        self.failures.append(line)

    def note(self, line):
        self.notes.append(line)


def load_json(path):
    with open(path, "rb") as fh:
        return json.load(fh)


def fetch_text(url, tries=3, timeout=90):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(
                url, headers={"User-Agent":
                              "Mozilla/5.0 (Macintosh; Intel Mac OS X "
                              "10_15_7) AppleWebKit/537.36 "
                              "(KHTML, like Gecko) Chrome/120.0 "
                              "Safari/537.36",
                              "Accept": "application/json, text/plain, */*"})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read().decode("utf-8", "replace")
        except Exception as exc:
            last = exc
            time.sleep(2 * (i + 1))
    raise RuntimeError("unreachable after %d tries (%s)" % (tries, last))


# ------------------------------------------------------------- daily file
HEADLINE_KEYS = ["SPX", "IXIC", "GOLD", "BTC", "VIX"]
PREFERRED_KEYS = ["STRC", "SATS"]  # price-only zone series
JUMP_LIMITS = {"index": 0.15, "btc": 0.35, "commodity": 0.20,
               "preferred": 0.20, "stock": 0.40}


def jump_class(key, fcd):
    if key in ("SPX", "IXIC"):
        return "index"
    if key == "BTC":
        return "btc"
    if key in getattr(fcd, "PREFERRED_KEYS", set()):
        return "preferred"
    if key in getattr(fcd, "BAND_KEYS", set()):
        return "commodity"
    return "stock"


def check_daily(suite, doc, expected_through, fcd):
    f = "finance-chart-daily.json"
    through_raw = doc.get("through")
    if not through_raw:
        suite.fail("%s: no through date" % f)
        return None
    through = d(through_raw)
    # BTC trades every calendar day, so on a run whose last
    # completed session is followed only by non-session days
    # (a holiday, a weekend) the builder's `through` — the max
    # over all series — legitimately sits past the session on
    # BTC's bar alone (first seen 2026-11-27: through 2026-11-26
    # on Thanksgiving night, last session 2026-11-25, and the
    # strict equality below failed a correct build 95 ways).
    # Accept that lead only when NO session day falls inside
    # it: a lead spanning a session means a session's data is
    # missing, which still fails. Session-bound series are
    # then judged against the session date, BTC against
    # `through` itself.
    lead_ok = (through > expected_through
               and sessions_between(expected_through, through) == 0)
    if through != expected_through and not lead_ok:
        suite.fail("%s: through is %s, but the last completed US "
                   "session is %s (calendar check)"
                   % (f, through, expected_through))
    if lead_ok:
        suite.note("%s: through %s is past the last session %s "
                   "only over non-session days (BTC) — accepted"
                   % (f, through, expected_through))
    session_through = expected_through if lead_ok else through
    series = doc.get("series") or {}
    if len(series) < 100:
        suite.fail("%s: only %d series (expected the full "
                   "universe)" % (f, len(series)))
    for key, entry in sorted(series.items()):
        bars = entry.get("bars") or []
        if not bars:
            suite.fail("%s: series %s has no bars" % (f, key))
            continue
        dates = [b[0] for b in bars]
        if dates != sorted(dates) or len(set(dates)) != len(dates):
            suite.fail("%s: series %s bar dates are not strictly "
                       "increasing" % (f, key))
        last_day = d(dates[-1])
        if last_day > through:
            suite.fail("%s: series %s ends %s, AFTER the through "
                       "date %s — a future bar" % (f, key, last_day,
                                                   through))
        if key != "BTC" and last_day > session_through:
            suite.fail("%s: series %s ends %s, AFTER the last "
                       "completed session %s — a future bar for a "
                       "session-bound series"
                       % (f, key, last_day, session_through))
        # BTC is judged against the file's own through; every
        # other headline series against the session date (the
        # two are identical unless the BTC lead above applied).
        headline_target = through if key == "BTC" else session_through
        if key in HEADLINE_KEYS and last_day != headline_target:
            suite.fail("%s: headline series %s ends %s, not the "
                       "through date %s" % (f, key, last_day,
                                            headline_target))
        elif sessions_between(last_day, session_through) > 3:
            suite.fail("%s: series %s ends %s, more than 3 "
                       "sessions before through %s"
                       % (f, key, last_day, session_through))
        # OHLC sanity + jump on the recent tail.
        for b in bars[-30:]:
            o, h, l, c = (float(b[1]), float(b[2]), float(b[3]),
                          float(b[4]))
            if c <= 0 or l <= 0:
                suite.fail("%s: series %s bar %s has a non-positive "
                           "price (close %s)" % (f, key, b[0], c))
                break
            if not (l <= min(o, c) * 1.0015 and max(o, c) <= h * 1.0015
                    and l <= h):
                suite.fail("%s: series %s bar %s has disordered "
                           "OHLC (o %s h %s l %s c %s)"
                           % (f, key, b[0], o, h, l, c))
                break
        if len(bars) >= 2 and key != "VIX":  # VIX is a volatility
            # index — 40%+ days are its nature, not garbage. Its
            # level is cross-checked against FRED VIXCLS instead.
            prev_c, last_c = float(bars[-2][4]), float(bars[-1][4])
            if prev_c > 0:
                jump = abs(last_c / prev_c - 1)
                limit = JUMP_LIMITS[jump_class(key, fcd)]
                if jump > limit:
                    suite.fail("%s: series %s last close moved "
                               "%+.1f%% in one day (limit %.0f%%) "
                               "with no split explanation in the data"
                               % (f, key, 100 * (last_c / prev_c - 1),
                                  100 * limit))
        if len(bars) >= 61 and key != "VIX":
            import statistics
            med = statistics.median(float(b[4]) for b in bars[-61:-1])
            if med > 0 and not (0.3 * med <= float(bars[-1][4]) <= 3.33 * med):
                suite.fail("%s: series %s last close %s is far "
                           "outside its own trailing 60-day range "
                           "(median %s)" % (f, key, bars[-1][4], med))
        # Dot integrity.
        bar_dates = set(dates)
        seen = {}
        for field in ("buy", "sell", "score_buys"):
            dots = entry.get(field) or []
            if key in PREFERRED_KEYS and field == "buy":
                # Zone-entry semantics: one day can enter up to
                # three zones (Shallow/Deep/Distress) and earns
                # one dot per zone — duplicates are the builder's
                # standing behaviour (STRC 2025-07-30 x2 and SATS
                # 2026-10-20 x2 in the live file, reproduced
                # exactly by the recompute below). Sortedness and
                # the 3-per-date cap still hold.
                counts = {}
                for v in dots:
                    counts[v] = counts.get(v, 0) + 1
                if dots != sorted(dots) or max(
                        counts.values(), default=0) > 3:
                    suite.fail("%s: series %s buy dots are not "
                               "sorted, or one date carries more "
                               "than the three zone entries"
                               % (f, key))
                continue
            if dots != sorted(dots) or len(set(dots)) != len(dots):
                suite.fail("%s: series %s %s dots are not sorted "
                           "and unique" % (f, key, field))
            for dt in dots:
                if dt not in bar_dates:
                    suite.fail("%s: series %s %s dot %s is not a "
                               "bar date" % (f, key, field, dt))
                    break
            seen[field] = set(dots)
        if seen.get("buy", set()) & seen.get("score_buys", set()):
            suite.fail("%s: series %s has a day in both buy and "
                       "score_buys" % (f, key))
        if seen.get("buy", set()) & seen.get("sell", set()):
            suite.fail("%s: series %s has a day in both buy and "
                       "sell" % (f, key))
    return series


def check_recompute(suite, doc, series, fcd, prev_series):
    f = "finance-chart-daily.json"
    vix = (series.get("VIX") or {}).get("bars") or []
    if not vix:
        suite.fail("%s: no VIX series — indicator cannot be "
                   "recomputed" % f)
        return
    vix_dates = [b[0] for b in vix]
    vix_closes = [float(b[4]) for b in vix]
    earnings = set(getattr(fcd, "EARNINGS_KEYS", []))
    checked = exact = 0
    for key, entry in sorted(series.items()):
        if key == "VIX":
            continue
        bars = entry.get("bars") or []
        if not bars:
            continue
        checked += 1
        buy, sell = fcd.compute_indicator_signals(
            key, bars, entry.get("pe"), vix_dates, vix_closes)
        pub_buy = entry.get("buy") or []
        pub_sell = entry.get("sell") or []
        score = [x for x in fcd.compute_score_buy_days(
            key, bars, entry.get("pe"), vix_dates, vix_closes)
            if x not in set(pub_buy)]
        pub_score = entry.get("score_buys") or []
        # The one legitimate exception to fresh recomputation,
        # for ANY series (earnings universe included): the
        # builder's one-run P/E carry — the series had a P/E
        # last run and has none now, so its published dots are
        # last run's, filtered to dates the current bars still
        # carry. score_buys may be carried the same way or
        # recomputed fresh; either fully-determined value is
        # accepted, nothing else is.
        if not entry.get("pe") and prev_series:
            prev = prev_series.get(key) or {}
            if prev.get("pe"):
                have = {b[0] for b in bars}
                exp_buy = [x for x in (prev.get("buy") or [])
                           if x in have]
                exp_sell = [x for x in (prev.get("sell") or [])
                            if x in have]
                exp_score = [x for x in (prev.get("score_buys")
                                         or []) if x in have]
                if exp_buy == pub_buy and exp_sell == pub_sell \
                        and pub_score in (exp_score, score):
                    suite.note("%s: series %s signals are the "
                               "documented one-run P/E carry "
                               "(reproduced from the previous "
                               "file)" % (f, key))
                    exact += 1
                    continue
        problems = []
        if key in earnings:
            if not set(buy) <= set(pub_buy):
                problems.append("recomputed buy days are not a "
                                "subset of published buys (B1 may "
                                "only add)")
            if not set(pub_sell) <= set(sell):
                problems.append("published sell days are not a "
                                "subset of recomputed sells (vetoes "
                                "may only remove)")
        elif buy != pub_buy or sell != pub_sell:
            problems.append("buy/sell dots do not match "
                            "recomputation (recomputed %d buy / "
                            "%d sell, published %d / %d)"
                            % (len(buy), len(sell),
                               len(pub_buy), len(pub_sell)))
        if score != pub_score:
            problems.append("score_buys do not match recomputation "
                            "(recomputed %d, published %d)"
                            % (len(score), len(pub_score)))
        if problems:
            suite.fail("%s: series %s — %s"
                       % (f, key, "; ".join(problems)))
        else:
            exact += 1
    suite.note("recompute: %d/%d series verified against the "
               "builder's own functions" % (exact, checked))


# ------------------------------------------------------------- btc state
def check_btc(suite, doc, now_utc):
    f = "btc-state.json"
    score = doc.get("score") or {}
    parts = score.get("parts") or {}
    value = score.get("value")
    if value is None or len(parts) != 4:
        suite.fail("%s: headline score or its four parts are "
                   "missing" % f)
    else:
        mean = sum(float(v) for v in parts.values()) / 4.0
        if abs(mean - float(value)) > 0.02:
            suite.fail("%s: headline score %s is not the mean of "
                       "its parts %s (mean %.2f)"
                       % (f, value, parts, mean))
        band = ("buy" if value <= 7.79 else
                "sell" if value >= 92.91 else "between")
        if score.get("band") != band:
            suite.fail("%s: score band is %s but score %s falls "
                       "in the %s band" % (f, score.get("band"),
                                           value, band))
    readings = doc.get("readings") or {}
    all_four = doc.get("all_four") or {}
    if readings and all_four:
        bands = {k: (v or {}).get("band") for k, v in readings.items()}
        if len(bands) == 4:
            if bool(all_four.get("buy")) != all(
                    b == "green" for b in bands.values()):
                suite.fail("%s: all_four.buy is %s but the four "
                           "reading bands are %s"
                           % (f, all_four.get("buy"), bands))
            if bool(all_four.get("sell")) != all(
                    b == "red" for b in bands.values()):
                suite.fail("%s: all_four.sell is %s but the four "
                           "reading bands are %s"
                           % (f, all_four.get("sell"), bands))
    series = doc.get("score_series") or []
    spiral = doc.get("spiral_series") or {}
    closes = spiral.get("closes") or []
    if not series or not closes:
        suite.fail("%s: score_series or spiral closes are empty" % f)
        return
    s_dates = [row[0] for row in series]
    c_dates = [row[0] for row in closes]
    if s_dates != sorted(s_dates) or len(set(s_dates)) != len(s_dates):
        suite.fail("%s: score_series dates are not strictly "
                   "increasing" % f)
    if c_dates != sorted(c_dates) or len(set(c_dates)) != len(c_dates):
        suite.fail("%s: spiral close dates are not strictly "
                   "increasing" % f)
    for row in series:
        if not (0 <= float(row[1]) <= 100):
            suite.fail("%s: score %s on %s is outside 0-100"
                       % (f, row[1], row[0]))
            break
    for i in range(1, len(s_dates)):
        gap = (d(s_dates[i]) - d(s_dates[i - 1])).days
        if gap > 3:
            suite.fail("%s: score_series has a %d-day hole ending "
                       "%s — a shifted or dropped day moves every "
                       "later dot" % (f, gap, s_dates[i]))
            break
    if s_dates[-1] != c_dates[-1]:
        suite.fail("%s: score_series ends %s but spiral closes "
                   "end %s — the page maps dots by date, so the "
                   "two must end together"
                   % (f, s_dates[-1], c_dates[-1]))
    missing = [x for x in s_dates if x not in set(c_dates)]
    if missing:
        suite.fail("%s: %d score days (e.g. %s) have no matching "
                   "spiral close date — dots would land on wrong "
                   "days" % (f, len(missing), missing[0]))
    as_of = doc.get("as_of")
    if as_of:
        stamp = datetime.strptime(as_of, "%Y-%m-%dT%H:%M:%SZ").replace(
            tzinfo=timezone.utc)
        age_h = (now_utc - stamp).total_seconds() / 3600.0
        if age_h > 26:
            suite.fail("%s: as_of %s is %.0f hours old at verify "
                       "time" % (f, as_of, age_h))
        last_age = (stamp.date() - d(s_dates[-1])).days
        if last_age > 2:
            suite.fail("%s: score_series ends %s, %d days before "
                       "the file's own as_of day %s"
                       % (f, s_dates[-1], last_age, stamp.date()))


# ------------------------------------------------------------- intraday + rungs
# ------------------------------------------------------- holiday lead
# BTC trades 24/7 and the VIX rungs' stamps follow the intraday
# build, so on a non-session run day (a holiday) those series
# legitimately carry the run date — exactly one calendar day
# past the daily file's last session — while the daily file
# correctly ends at that session. Johnny approved accepting
# exactly that shape (2026-11-26); every other lead still fails.
_ALWAYS_ON_KEYS = {"BTC", "VIX"}


def _holiday_lead(day, through, run_day):
    """True only for the approved holiday shape: the run date
    is not an NYSE session day (this module's own calendar,
    is_session) and `day` is exactly one calendar day past the
    daily through."""
    return (not is_session(run_day)
            and day == through + timedelta(days=1))


def check_intraday(suite, doc, through, run_day):
    f = "finance-intraday.json"
    iday = d(doc.get("through") or "1970-01-01")
    if iday != through:
        if _holiday_lead(iday, through, run_day):
            suite.note("%s: through %s is one day past daily "
                       "through %s — the accepted holiday lead "
                       "(non-session run day %s)"
                       % (f, iday, through, run_day))
        else:
            suite.fail("%s: through is %s, daily through is %s"
                       % (f, doc.get("through"), through))
    for key, entry in sorted((doc.get("series") or {}).items()):
        sess = entry.get("sessions") or []
        if not sess:
            suite.fail("%s: series %s has no sessions" % (f, key))
            continue
        last = d(sess[-1].get("date") or "1970-01-01")
        if key in HEADLINE_KEYS and last != through:
            if key in _ALWAYS_ON_KEYS and _holiday_lead(
                    last, through, run_day):
                suite.note("%s: headline series %s last session "
                           "%s is the accepted holiday lead "
                           "over daily through %s"
                           % (f, key, last, through))
            else:
                suite.fail("%s: headline series %s last session is "
                           "%s, not %s" % (f, key, last, through))
        elif sessions_between(last, through) > 3:
            suite.fail("%s: series %s last session %s lags "
                       "through %s by more than 3 sessions"
                       % (f, key, last, through))


def check_rungs(suite, base_dir, daily_keys, through, allow_partial,
                now_utc, run_day):
    for rung in ("fine5", "fine15", "fine30", "fine60"):
        rdir = os.path.join(base_dir, rung)
        if not os.path.isdir(rdir):
            suite.fail("%s/: directory missing — the fine layers "
                       "did not build" % rung)
            continue
        files = {fn[:-5] for fn in os.listdir(rdir)
                 if fn.endswith(".json")}
        if not allow_partial:
            missing = daily_keys - files
            if missing:
                suite.fail("%s/: %d series files missing (e.g. "
                           "%s) — a failed fine fetch leaves the "
                           "previous file, but a missing file means "
                           "the chart silently falls back to daily "
                           "bars for it"
                           % (rung, len(missing), sorted(missing)[0]))
        for key in sorted(files):
            path = os.path.join(rdir, key + ".json")
            try:
                doc = load_json(path)
            except Exception as exc:
                suite.fail("%s/%s.json: does not parse (%s)"
                           % (rung, key, exc))
                continue
            if doc.get("schema") != "finance-fine/v1":
                suite.fail("%s/%s.json: unexpected schema %s"
                           % (rung, key, doc.get("schema")))
            if doc.get("key") != key:
                suite.fail("%s/%s.json: carries key %s — wrong-"
                           "symbol mapping" % (rung, key,
                                               doc.get("key")))
            bars = doc.get("bars") or []
            if not bars:
                suite.fail("%s/%s.json: no bars" % (rung, key))
                continue
            ts = [b[0] for b in bars]
            if ts != sorted(ts):
                suite.fail("%s/%s.json: bar timestamps are not "
                           "increasing" % (rung, key))
            fthrough = doc.get("through_et")
            if not fthrough:
                suite.fail("%s/%s.json: no through_et" % (rung, key))
                continue
            fday = d(fthrough)
            if key in HEADLINE_KEYS or key in _JOHNNY19:
                if fday != through:
                    if key in _ALWAYS_ON_KEYS and _holiday_lead(
                            fday, through, run_day):
                        suite.note("%s/%s.json: through_et %s is "
                                   "the accepted holiday lead "
                                   "over daily through %s"
                                   % (rung, key, fday, through))
                    else:
                        suite.fail("%s/%s.json: through_et is %s, "
                                   "daily through is %s — this rung "
                                   "did not refresh tonight"
                                   % (rung, key, fday, through))
            elif sessions_between(fday, through) > 1:
                suite.fail("%s/%s.json: through_et %s lags daily "
                           "through %s by more than one session"
                           % (rung, key, fday, through))
            gen = doc.get("generated_at")
            if gen:
                stamp = datetime.strptime(
                    gen, "%Y-%m-%dT%H:%M:%SZ").replace(
                    tzinfo=timezone.utc)
                age_h = (now_utc - stamp).total_seconds() / 3600.0
                if age_h > 26:
                    suite.fail("%s/%s.json: generated_at %s is "
                               "%.0f hours old — this rung did "
                               "not rebuild tonight"
                               % (rung, key, gen, age_h))
                last_et = datetime.fromtimestamp(
                    ts[-1], tz=timezone.utc).astimezone(ET).date()
                if last_et < fday:
                    suite.fail("%s/%s.json: last bar lands on %s "
                               "ET, before its own through_et %s"
                               % (rung, key, last_et, fday))


_JOHNNY19 = {"GOOGL", "ASST", "CIFR", "SPCX", "NBIS", "IREN",
             "AAOI", "NVDA", "AMD", "PLTR", "MU", "TSLA", "MSTR",
             "TSM", "LLY", "WM", "COST", "JPM", "WMT"}


# ------------------------------------------------------------- cross-check
# Which source verified each leg tonight; main() writes this to
# verification-report.json so a fallback-verified publish is
# visible outside the run log (the watchdog reads the served
# copy).
VERIFY_SOURCES = {}


def _compare(suite, label, mine, ref, tol, min_common, newest_within,
             through):
    common = sorted(set(mine) & set(ref))
    if len(common) < min_common:
        suite.fail("crosscheck %s: only %d common dates with the "
                   "independent source (need %d) — cannot verify"
                   % (label, len(common), min_common))
        return
    recent = common[-3:]
    newest = d(recent[-1])
    if (through - newest).days > newest_within:
        suite.fail("crosscheck %s: independent source's newest "
                   "comparable date is %s, too far behind through "
                   "%s to verify tonight's close"
                   % (label, newest, through))
        return
    for day in recent:
        diff = abs(mine[day] / ref[day] - 1)
        if diff > tol:
            suite.fail("crosscheck %s: %s close — built %.4f, "
                       "independent source %.4f (%+.2f%%, "
                       "tolerance %.2f%%)"
                       % (label, day, mine[day], ref[day],
                          100 * (mine[day] / ref[day] - 1), 100 * tol))
            return
    suite.note("crosscheck %s: %d dates agree within %.2f%%"
               % (label, len(recent), 100 * tol))


def _fred(series_id):
    cosd = (date.today() - timedelta(days=400)).isoformat()
    raw = fetch_text("https://fred.stlouisfed.org/graph/"
                     "fredgraph.csv?id=%s&cosd=%s" % (series_id, cosd))
    out = {}
    for row in csv.reader(io.StringIO(raw)):
        if len(row) == 2 and row[1] not in (".", ""):
            try:
                out[row[0]] = float(row[1])
            except ValueError:
                pass
    return out


def _cboe_index(name):
    """CBOE's published daily prices for one of its indexes
    ("SPX" or "VIX"), as {iso-date: close}. CBOE publishes the
    VIX and is the licensed disseminator of SPX index values —
    the official source, independent of Yahoo. The SPX file is
    DATE,SPX; the VIX file is DATE,OPEN,HIGH,LOW,CLOSE; the
    header row names the columns either way."""
    raw = fetch_text("https://cdn.cboe.com/api/global/us_indices/"
                     "daily_prices/%s_History.csv" % name)
    rows = [r for r in csv.reader(io.StringIO(raw)) if r]
    head = [c.strip().upper() for c in rows[0]]
    col = head.index("CLOSE") if "CLOSE" in head else 1
    out = {}
    for row in rows[1:]:
        if len(row) <= col:
            continue
        try:
            day = datetime.strptime(row[0].strip(),
                                    "%m/%d/%Y").strftime("%Y-%m-%d")
            out[day] = float(row[col])
        except (ValueError, IndexError):
            pass
    return out


def _nasdaq_index(sym, through):
    """Nasdaq's official history for an index symbol (COMP is
    the Nasdaq Composite, whose publisher is Nasdaq itself),
    or None."""
    try:
        raw = fetch_text(
            "https://api.nasdaq.com/api/quote/%s/"
            "historical?assetclass=index&fromdate=%s&limit=9999"
            % (sym, (through - timedelta(days=45)).isoformat()))
        rows = ((json.loads(raw).get("data") or {})
                .get("tradesTable", {}).get("rows") or [])
        if rows:
            ref = {}
            for r in rows:
                day = datetime.strptime(
                    r["date"], "%m/%d/%Y").strftime("%Y-%m-%d")
                ref[day] = float(r["close"].replace("$", "")
                                 .replace(",", ""))
            return ref
    except Exception:
        pass
    return None


def _nasdaq(sym, through):
    """Nasdaq official history for one symbol, or None."""
    for assetclass in ("stocks", "etf"):
        try:
            raw = fetch_text(
                "https://api.nasdaq.com/api/quote/%s/"
                "historical?assetclass=%s&fromdate=%s&limit=9999"
                % (sym, assetclass,
                   (through - timedelta(days=20)).isoformat()))
            rows = ((json.loads(raw).get("data") or {})
                    .get("tradesTable", {}).get("rows") or [])
            if rows:
                ref = {}
                for r in rows:
                    day = datetime.strptime(
                        r["date"], "%m/%d/%Y").strftime("%Y-%m-%d")
                    ref[day] = float(r["close"].replace("$", "")
                                     .replace(",", ""))
                return ref
        except Exception:
            pass
    return None


def check_crosscheck(suite, series, through):
    def closes(key, n=12):
        return {b[0]: float(b[4])
                for b in (series.get(key) or {}).get("bars", [])[-n:]}
    # Indexes via FRED (Federal Reserve Bank of St. Louis —
    # independent of Yahoo, the builders' feed). FALLBACK
    # (Johnny, 2026-11-26): only when a FRED leg is unreachable
    # after its retries does that leg fall back to the index's
    # own publisher — SPX/VIX to CBOE's published daily prices,
    # IXIC to Nasdaq's official COMP history — with the SAME
    # tolerance and the SAME comparison. A fallback that
    # disagrees, or is also unreachable, still fails the leg.
    for key, fid, tol, minc, within in (
            ("SPX", "SP500", 0.0035, 2, 5),
            ("IXIC", "NASDAQCOM", 0.0035, 2, 7),
            ("VIX", "VIXCLS", 0.01, 2, 5)):
        ref = None
        fred_exc = None
        try:
            ref = _fred(fid)
        except Exception as exc:
            fred_exc = exc
        if ref is not None:
            VERIFY_SOURCES[key] = "FRED %s" % fid
            _compare(suite, "%s vs FRED %s" % (key, fid),
                     closes(key), ref, tol, minc, within, through)
            continue
        # FRED unreachable after its retries — publisher
        # fallback, never consulted when FRED answers.
        try:
            if key == "IXIC":
                ref = _nasdaq_index("COMP", through)
                if ref is None:
                    raise RuntimeError("no COMP history returned")
                src = "Nasdaq official index history (COMP)"
            else:
                ref = _cboe_index(key)
                src = "CBOE published daily prices (%s)" % key
        except Exception as fb_exc:
            suite.fail("crosscheck %s: independent source (FRED "
                       "%s) %s; fallback source also failed (%s)"
                       % (key, fid, fred_exc, fb_exc))
            VERIFY_SOURCES[key] = ("UNVERIFIED — FRED and its "
                                   "fallback both failed")
            continue
        VERIFY_SOURCES[key] = "FALLBACK %s (FRED unreachable)" % src
        suite.note("crosscheck %s: FRED %s UNREACHABLE (%s) — "
                   "this leg was verified against the FALLBACK "
                   "source, %s, NOT against FRED"
                   % (key, fid, fred_exc, src))
        _compare(suite, "%s vs FALLBACK %s" % (key, src),
                 closes(key), ref, tol, minc, within, through)
    # BTC via Coinbase Exchange daily candles (independent of
    # both Yahoo and CoinMetrics).
    try:
        raw = fetch_text("https://api.exchange.coinbase.com/"
                         "products/BTC-USD/candles?granularity=86400")
        ref = {}
        for c in json.loads(raw):
            day = datetime.fromtimestamp(
                c[0], timezone.utc).strftime("%Y-%m-%d")
            ref[day] = float(c[4])
    except Exception as exc:
        suite.fail("crosscheck BTC: independent source (Coinbase) "
                   "%s" % exc)
        ref = None
        VERIFY_SOURCES["BTC"] = "UNVERIFIED — Coinbase failed"
    if ref:
        VERIFY_SOURCES["BTC"] = "Coinbase"
        _compare(suite, "BTC vs Coinbase", closes("BTC"), ref,
                 0.01, 2, 2, through)
    # GOLD (front-month futures) vs GLD (spot-backed ETF):
    # levels are not comparable, daily RETURNS must track.
    # Calibration 2026-11-24: the four newest common-date
    # returns differed by 0.25–0.94 points; tolerance 1.5.
    gld = _nasdaq("GLD", through)
    if gld is None:
        VERIFY_SOURCES["GOLD"] = "UNVERIFIED — Nasdaq GLD failed"
        suite.fail("crosscheck GOLD: independent source "
                   "(Nasdaq GLD history) unreachable")
    else:
        VERIFY_SOURCES["GOLD"] = "Nasdaq GLD daily returns"
        mine = closes("GOLD", 30)
        common = sorted(set(mine) & set(gld))
        if len(common) < 4:
            suite.fail("crosscheck GOLD vs GLD: only %d common "
                       "dates — cannot compare returns"
                       % len(common))
        else:
            bad = None
            for i in range(len(common) - 3, len(common)):
                day, prev = common[i], common[i - 1]
                diff = abs((mine[day] / mine[prev] - 1)
                           - (gld[day] / gld[prev] - 1))
                if diff > 0.015:
                    bad = (day, diff)
                    break
            if bad:
                suite.fail("crosscheck GOLD vs GLD: the %s "
                           "daily return differs from GLD's by "
                           "%.2f points (tolerance 1.50)"
                           % (bad[0], bad[1] * 100))
            else:
                suite.note("crosscheck GOLD vs GLD: last 3 "
                           "daily returns track within 1.50 "
                           "points")
    # Rotating ticker sample via Nasdaq official history
    # (independent of Yahoo). Rotation is by date so every
    # eligible ticker is sampled roughly once a fortnight.
    cands = sorted(k for k, e in series.items()
                   if (e.get("symbol") or "").isalpha()
                   and len(e.get("symbol") or "") <= 5
                   and k not in HEADLINE_KEYS
                   and k not in _JOHNNY19_EXCLUDE)
    if cands:
        start = (through.toordinal() % len(cands))
        sample = [cands[(start + i) % len(cands)] for i in range(8)]
        found = 0
        for key in sample:
            sym = series[key]["symbol"]
            ref = _nasdaq(sym, through)
            if not ref:
                suite.note("crosscheck %s: Nasdaq carries no "
                           "history for %s — noted, not failed"
                           % (key, sym))
                continue
            found += 1
            _compare(suite, "%s vs Nasdaq" % key, closes(key), ref,
                     0.005, 2, 5, through)
        VERIFY_SOURCES["tickers"] = ("Nasdaq official history "
                                      "(rotating sample)")
        if found < 6:
            suite.fail("crosscheck tickers: only %d of the sampled "
                       "8 tickers could be verified against Nasdaq "
                       "(need 6)" % found)
        else:
            suite.note("crosscheck tickers: rotating sample of %d "
                       "verified against Nasdaq" % found)


_JOHNNY19_EXCLUDE = set()  # Johnny's 19 ARE eligible for sampling


# ------------------------------------------------------------- main
def main():
    args = sys.argv[1:]
    base_dir = os.getcwd()
    prev_path = None
    allow_partial = "--allow-partial-rungs" in args
    skip_cross = "--skip-crosscheck" in args
    i = 0
    while i < len(args):
        if args[i] == "--dir":
            base_dir = args[i + 1]
            i += 2
        elif args[i] == "--prev":
            prev_path = args[i + 1]
            i += 2
        else:
            i += 1

    suite = Suite()
    now_utc = datetime.now(timezone.utc)
    now_et = now_utc.astimezone(ET)
    run_day = now_et.date()
    expected_through = last_completed_session(now_et)

    # The builder module is the reference implementation for the
    # recomputation. It sits beside this file in the repo; for
    # local runs it may sit in the artifact dir instead.
    fcd = None
    for cand in (os.path.dirname(os.path.abspath(__file__)), base_dir):
        if os.path.exists(os.path.join(cand, "fetch_chart_data.py")):
            sys.path.insert(0, cand)
            try:
                import fetch_chart_data as fcd
            except Exception as exc:
                suite.fail("recompute: fetch_chart_data.py could "
                           "not be imported (%s)" % exc)
            break
    if fcd is None:
        suite.fail("recompute: fetch_chart_data.py not found — "
                   "the indicator cannot be recomputed")

    daily = None
    daily_path = os.path.join(base_dir, "finance-chart-daily.json")
    try:
        daily = load_json(daily_path)
    except Exception as exc:
        suite.fail("finance-chart-daily.json: does not parse (%s)"
                   % exc)
    series = None
    through = expected_through
    if daily is not None:
        series = check_daily(suite, daily, expected_through, fcd)
        if daily.get("through"):
            through = d(daily["through"])
            # Sibling files (intraday, fine rungs) and the
            # cross-check anchor on the SESSION date: when the
            # daily through leads it only over non-session days
            # (BTC's holiday/weekend bar), the session-bound
            # series in those files correctly end at the
            # session, and their own BTC/VIX leads are judged
            # by the existing holiday-lead rule against it.
            if (through > expected_through
                    and sessions_between(expected_through,
                                         through) == 0):
                through = expected_through
    if daily is not None and series and fcd is not None:
        prev_series = None
        if prev_path:
            try:
                prev_series = (load_json(prev_path) or {}).get("series")
            except Exception:
                prev_series = None
        else:
            try:
                raw = subprocess.run(
                    ["git", "show", "HEAD:finance-chart-daily.json"],
                    cwd=base_dir, capture_output=True, timeout=120)
                if raw.returncode == 0 and raw.stdout:
                    prev_series = (json.loads(raw.stdout) or {}).get("series")
            except Exception:
                prev_series = None
        check_recompute(suite, daily, series, fcd, prev_series)

    btc_path = os.path.join(base_dir, "btc-state.json")
    try:
        check_btc(suite, load_json(btc_path), now_utc)
    except Exception as exc:
        suite.fail("btc-state.json: does not parse (%s)" % exc)

    intra_path = os.path.join(base_dir, "finance-intraday.json")
    try:
        check_intraday(suite, load_json(intra_path), through,
                       run_day)
    except Exception as exc:
        suite.fail("finance-intraday.json: does not parse (%s)"
                   % exc)

    if series:
        check_rungs(suite, base_dir, set(series.keys()), through,
                    allow_partial, now_utc, run_day)
        if not skip_cross:
            check_crosscheck(suite, series, through)

    # The verification report is committed with the data, so
    # the watchdog (and anyone) can see WHICH source verified
    # each leg — in particular whether any leg ran on its
    # fallback. On a failed run nothing commits, so the served
    # copy always describes the last PUBLISHED data.
    report = {
        "generated_at": now_utc.isoformat(),
        "through": through.isoformat(),
        "crosscheck_skipped": skip_cross,
        "fallback_used": any(str(v).startswith("FALLBACK")
                             for v in VERIFY_SOURCES.values()),
        "sources": VERIFY_SOURCES,
    }
    try:
        with open(os.path.join(base_dir,
                               "verification-report.json"),
                  "w") as fh:
            json.dump(report, fh, indent=1, sort_keys=True)
            fh.write("\n")
    except Exception as exc:
        print("WARNING: verification-report.json could not be "
              "written (%s)" % exc)

    for line in suite.notes:
        print("ok: %s" % line)
    if suite.failures:
        for line in suite.failures:
            print("FAIL: %s" % line)
        print("VERIFY FAILED — %d problem(s); the commit step "
              "must not run." % len(suite.failures))
        return 1
    print("VERIFY PASSED — built data is internally consistent, "
          "calendar-true, and cross-checked.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
