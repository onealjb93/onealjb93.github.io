#!/usr/bin/env python3
"""Nightly Bitcoin golden-state writer for johnny-oneal.com.

Computes the same four buy-zone readings the Bitcoin page's buy-time
indicator publishes (power law, production cost, Mayer Multiple, MVRV
Z-Score) from the same public feeds the page itself uses, and writes
one tiny file, btc-state.json, at the repo root:

    {"golden": bool, "top": bool, "as_of": "<UTC ISO timestamp>",
     "price": <spot USD>, "data": {"mvrv_day": "YYYY-MM-DD"},
     "readings": {"powerlaw": {"pos": ..., "band": ..., "pct": ...},
                  "cost":     {"pos": ..., "band": ..., "pct": ...},
                  "mayer":    {"ratio": ..., "band": ..., "pct": ...},
                  "mvrv":     {"z": ..., "band": ..., "pct": ...}},
     "all_four": {"buy": bool, "sell": bool},
     "score": {"value": ..., "band": "buy" | "sell" | "between",
               "parts": {"powerlaw": ..., "cost": ...,
                         "mayer": ..., "mvrv": ...}},
     "record": {...}, "score_record": {...},
     "score_series": [["2011-02-02", ...], ...],
     "spiral_series": {"source": ..., "first": "2010-07-18",
                       "last": "YYYY-MM-DD",
                       "closes": [["2010-07-18", ...], ...]}}

Each reading's "pct" is the percent note the page's indicator prints
beside the model's name (its fmtDist input): how far the price sits
from that model's own bottom line, as a signed percent — negative is
under the line, positive is above it. The quantities are the page's
own, per model: power law, price vs the corridor floor (fair x LO);
production cost, price vs today's cost; Mayer, the ratio minus one;
MVRV, market cap vs realized cap (the CoinMetrics ratio minus one).

"golden" is true exactly when Johnny's combined score (below) is
in its buy band, and "top" exactly when the score is in its sell
band — the Rare Buy / Rare Sell trigger since the overlay v2 build
(2026-11-19). Every page's header fetches this file and shows a
gold star only while it says golden and is fresh, so the star now
follows the score. The previous all-four-at-once states are kept
verbatim under "all_four": "buy" is true exactly when all four
models read green at once — the page's own per-model rule
(power-law position <= 5, cost position <= 5, Mayer <= 1.0, MVRV
ratio <= 1.15); "sell" is its mirror — all four models stretched
at once (power-law position >= 95, production cost by its ratio:
price at least 10x the cost of production, Mayer >= 2.4, MVRV
Z >= 7). The cost leg of the sell state is a threshold on the
ratio, like Mayer's and MVRV's own thresholds, because the cost
position's scale is anchored to the single December 2017 peak
ratio (22.21): the top 5% of that scale needs a ratio over 21 and
has never been reached on a weekly sample.

"score" is Johnny's overlay score: each of the four models is
scaled to 0-100 against fixed anchors — the power law by its
corridor position clipped to 0-100, production cost by its ratio
on a log scale (a ratio of 1 scores 0, a ratio of 10 scores 100),
the Mayer Multiple linearly (0.5 scores 0, 2.4 scores 100), the
MVRV Z-Score linearly (0 scores 0, 7 scores 100) — and the score
is the simple average of the four scalings. The buy band is a
score of 7.79 or lower; the sell band is a score of 92.91 or
higher; in the measured daily record the buy band fired on 115
of the 5,764 days and the sell band on 114 (2.0% of days each,
at one decimal). The score's own weekly record rides
alongside under "score_record": {"weeks", "buy_weeks",
"sell_weeks", "last_buy_end", "last_sell_end"}, counted over the
same baked weekly series and with the same completed-episode rule
as "record".

"score_series" is the score's full daily history — one
[ISO date, score] pair per day from 2011-02-02 (the first day all
four models have a reading) to the latest complete day in the
feeds, each score rounded to 2 decimals — so the Bitcoin page's
combined-score chart is drawn from this file's own computation,
never a page-side recomputation of the score. The construction is
the measured pipeline's, day for day: the MVRV Z-Score built up
day by day over the CoinMetrics history (Welford), the Mayer
Multiple against the trailing 200 daily closes including the day
itself, the power-law position from the day's closing price, and
the production cost from the day's own 4-day grid cell of the
page's baked inputs. Past the baked grid's last cell the cost
follows the page's own live-tail method — the day's difficulty
from mempool.space's adjustment history (difficulty is constant
inside an adjustment period), with the last baked fees standing
in for the tail's — so the series runs to the feeds' latest day
instead of stopping at the grid's edge; if that history cannot be
read, the series simply ends at the grid's edge.

"spiral_series" is the Bitcoin Spiral's daily-close series: the
full CoinMetrics PriceUSD history this run already fetched (the
cm_prices map behind the MVRV reading), as one [ISO date, close]
pair per day from 2010-07-18 onward, closes rounded to 4 decimals.
The Spiral's baked floors stop aging against it: the page rebuilds
its spiral from this series whenever the series' "last" is fresher
than the page's baked copy. The key is additive — every other key
is computed and written exactly as before, and no other reader of
this file (the headers, the indicator, golden_alert.py) reads it.

"cycle_extremes" is the current halving cycle's extremes, from
Yahoo Finance's BTC-USD daily OHLC — the real traded highs and
lows, which the CoinMetrics closes behind "spiral_series" cannot
see (a close-only series once let the Spiral's fine print call the
Jun 30, 2026 close the cycle's bottom weeks after the real traded
low had undercut it). The object carries the cycle top — the
highest intraday high and the highest close of the cycle, each
with its date and its cycle day (the halving day, 2024-04-20, is
day 1, the Spiral's own counting) — and the bottom of the decline
from that top: the lowest intraday low and the lowest close since
the top's day, likewise dated. The bottom is measured from the
top because that is the bottom the Spiral claims — the low that
follows the top; the cycle's early months dipped lower on the way
up (Aug 2024), before the top existed, and the object's "basis"
field says so in the published file. Like every other feed here,
a Yahoo failure fails the run and writes nothing: stale extremes
must never be published as fresh.

The state also carries a "record" object — the all-four record,
still published unchanged (the alert emails state the score's
record, under "score_record"): {"weeks", "golden_weeks",
"top_weeks", "last_golden_end", "last_top_end"}, counted over the
page's baked
weekly series (the Mayer block's BAKED sample days are the grid,
Feb 2016 on; power law and production cost are carried from their
4-day grid, MVRV is last-value-carried-forward from its baked rows —
the rarity measurement's own grid and rules, so the published
counts are the measured ones: 564 weeks, golden in 6, top in 2).
A "last_*_end" is the last sample day of the most recent COMPLETED
episode of that kind: a run that reaches the final sample while the
same state is live today may still be running, so that run is not
counted as completed and the previous episode's end stands instead.

The formulas below are line-for-line ports of the page's own readout
code in bitcoin.html (the four text/plain model blocks), and the cost
model's baked inputs (the DIFF / FEES grids and the EFF / SUB era
tables) are parsed out of bitcoin.html itself at run time, so the
script can never drift from the model the page publishes. Feeds are
the page's own: Coinbase spot + daily candles (Kraken fallbacks),
mempool.space for the current difficulty, and the CoinMetrics
community API for market cap and the MVRV ratio.

Fail-safe by construction: if any feed fails, any parsed input is
missing, or any reading falls outside sane bounds, the script exits
non-zero and writes NOTHING — the previous btc-state.json stands,
goes stale, and the headers hide the star on staleness. A wrong star
can never be published by a half-failed run.

The same run also renders og-bitcoin.jpg, the Bitcoin page's share
snapshot: the page's own power-law chart (its baked series plus the
state's spot point, its corridor, bands, zone markers and today dot)
with the page's own stats row, drawn from the SAME state dict and
baked inputs as btc-state.json — never a separate computation. The
image carries its date ("Snapshot · Nov 18, 2026"), so a cached
preview reads as a dated snapshot, never a live claim. Rendering is
best-effort: if Pillow is unavailable or drawing fails, the state
file still stands and only the snapshot stays stale.
"""

import json
import math
import os
import re
import sys
import time
from datetime import datetime, timezone, date, timedelta

import requests

HERE = os.path.dirname(os.path.abspath(__file__))
PAGE_PATH = os.path.join(HERE, "bitcoin.html")
OUT_PATH = os.path.join(HERE, "btc-state.json")
OG_PATH = os.path.join(HERE, "og-bitcoin.jpg")

GENESIS = date(2009, 1, 3)
DAY_S = 86400

# Power-law constants, from the page's btc-pl-code block.
PL_A, PL_N, PL_LO, PL_HI = -16.493, 5.688, 0.398, 2.512
# Cost-model constant, from the page's btc-cost-code block.
ELEC = 0.05  # $ per kWh
GRID_START, GRID_STEP = 592, 4
# The Top zone's cost leg: price at least 10x the cost of production.
# A threshold on the ratio, like Mayer's 2.4 and MVRV's 7 — the cost
# position's scale is anchored to the Dec 2017 peak ratio (22.21), so
# its top 5% (a ratio of ~21.2) has never been reached. On the baked
# weekly record the other three top legs have coincided only in the
# weeks of Dec 7 and 14, 2017, at ratios of 15.7 and 20.1; a 10x
# threshold fires in exactly those weeks and nowhere else (2 of 564).
COST_TOP_RATIO = 10
# Johnny's overlay score bands (2026-11-19): the score is the simple
# average of the four models' fixed-anchor scalings (score_parts
# below); each band fired on 115 of the 5,764 days in the measured
# daily record — 2.0% of days per side.
SCORE_BUY = 7.79
SCORE_SELL = 92.91

# The current halving cycle, for "cycle_extremes" (2026-11-22): the
# fourth halving fell on 2024-04-20, and the Spiral counts the
# halving day itself as day 1 of the cycle, so a date's cycle day
# is (date - CYCLE_HALVING).days + 1.
CYCLE_HALVING = date(2024, 4, 20)

TIMEOUT = 30


def fail(msg):
    print("update_btc_state: ERROR: %s" % msg, file=sys.stderr)
    sys.exit(1)


def get_json(url, params=None):
    resp = requests.get(url, params=params, timeout=TIMEOUT,
                        headers={"User-Agent": "johnny-oneal.com nightly updater"})
    resp.raise_for_status()
    return resp.json()


# ---------------------------------------------------------------- page inputs

def _block(src, block_id):
    m = re.search(r'id="%s">(.*?)</script>' % re.escape(block_id), src, re.S)
    if not m:
        fail("bitcoin.html: block %s not found" % block_id)
    return m.group(1)


def _array(block_text, name):
    m = re.search(r"var %s = (\[.*?\]);" % name, block_text, re.S)
    if not m:
        fail("bitcoin.html: array %s not found" % name)
    try:
        return json.loads(m.group(1))
    except ValueError:
        fail("bitcoin.html: array %s did not parse" % name)


def load_page_inputs():
    """The cost model's baked inputs, parsed from the page itself."""
    try:
        with open(PAGE_PATH, "r", encoding="utf-8") as fh:
            src = fh.read()
    except OSError as exc:
        fail("cannot read bitcoin.html: %s" % exc)
    cost = _block(src, "btc-cost-code")
    pl = _block(src, "btc-pl-code")
    mayer = _block(src, "btc-mayer-code")
    mvrv = _block(src, "btc-mvrv-code")
    inputs = {
        "prices": _array(pl, "PRICES"),
        "diff": _array(cost, "DIFF"),
        "fees": _array(cost, "FEES"),
        "eff": _array(cost, "EFF"),
        "sub": _array(cost, "SUB"),
        "mayer_baked": _array(mayer, "BAKED"),
        "mvrv_baked": _array(mvrv, "BAKED"),
    }
    n = len(inputs["prices"])
    if not (len(inputs["diff"]) == len(inputs["fees"]) == n and n > 1000):
        fail("baked grids disagree or are implausibly short")
    if not (len(inputs["mayer_baked"]) > 400
            and len(inputs["mvrv_baked"]) > 400):
        fail("baked Mayer / MVRV series implausibly short")
    return inputs


# ------------------------------------------------------------------- the model
# Line-for-line ports of the page's readout math (bitcoin.html).

def era_val(table, day):
    v = table[0][1]
    for first_day, val in table:
        if day >= first_day:
            v = val
    return v


def cost_for(day, diff_t, fees, eff, sub):
    hashes_per_block = diff_t * 1e12 * 4294967296  # difficulty x 2^32
    joules_per_day = hashes_per_block * era_val(eff, day) * 1e-12 * 144
    elec_per_day = joules_per_day / 3.6e6 * ELEC
    return elec_per_day / (144 * era_val(sub, day) + fees)


def peak_ratio(inputs):
    """The cost scale's anchor: the highest price-to-cost ratio in the
    baked series from Jan 1, 2016 on — computed from the baked series
    only, exactly as the page computes it."""
    peak_from = (date(2016, 1, 1) - GENESIS).days
    peak = 1.0
    for i, price in enumerate(inputs["prices"]):
        day = GRID_START + i * GRID_STEP
        if day < peak_from:
            continue
        ratio = price / cost_for(day, inputs["diff"][i], inputs["fees"][i],
                                 inputs["eff"], inputs["sub"])
        if ratio > peak:
            peak = ratio
    return peak


def band_of_pos(pos):
    if pos <= 5:
        return "green"
    if pos <= 50:
        return "yellow"
    return "red"


# ------------------------------------------------------------- overlay score
# Johnny's combined score (overlay v2, 2026-11-19): each model scaled
# 0-100 against fixed anchors, the score the simple average. These
# functions are the production form of the measured test pipeline's
# Variant B scalings (btc-averaged-score) — same anchors, same clip —
# and the proof in that build's REPORT is that this code reproduces
# the test's values on shared inputs.

def _clip100(v):
    return max(0.0, min(100.0, v))


def score_parts(pl_pos, cost_ratio, mayer, mvrv_z):
    """The four scalings, from the four models' raw values: the power
    law by its corridor position, production cost by its ratio on a
    log scale (1 -> 0, 10 -> 100), the Mayer Multiple linearly
    (0.5 -> 0, 2.4 -> 100), the MVRV Z-Score linearly (0 -> 0,
    7 -> 100); each clipped to 0-100."""
    return {
        "powerlaw": _clip100(pl_pos),
        "cost": _clip100(100.0 * math.log10(cost_ratio)
                         / math.log10(10.0)) if cost_ratio > 0 else 0.0,
        "mayer": _clip100(100.0 * (mayer - 0.5) / (2.4 - 0.5)),
        "mvrv": _clip100(100.0 * mvrv_z / 7.0),
    }


def score_value(parts):
    return sum(parts.values()) / 4.0


def score_band(score):
    if score <= SCORE_BUY:
        return "buy"
    if score >= SCORE_SELL:
        return "sell"
    return "between"


# ----------------------------------------------------------------------- feeds

def fetch_spot():
    try:
        j = get_json("https://api.coinbase.com/v2/prices/BTC-USD/spot")
        v = float(j["data"]["amount"])
        if v > 0:
            return v
    except Exception:
        pass
    try:
        j = get_json("https://api.kraken.com/0/public/Ticker?pair=XBTUSD")
        res = j["result"]
        key = next(iter(res))
        v = float(res[key]["c"][0])
        if v > 0:
            return v
    except Exception:
        pass
    fail("spot price unavailable from Coinbase and Kraken")


def fetch_closes(today):
    """Coinbase Exchange daily closes from Jan 1, 2015, paginated in
    300-day windows like the page; Kraken OHLC (~720 days) as fallback.
    Returns a sorted list of (day_number, close)."""
    closes = {}
    try:
        start = date(2015, 1, 1)
        end = GENESIS + timedelta(days=today + 1)
        t = start
        while t <= GENESIS + timedelta(days=today):
            rows = get_json(
                "https://api.exchange.coinbase.com/products/BTC-USD/candles",
                params={"granularity": 86400,
                        "start": t.isoformat(),
                        "end": min(t + timedelta(days=300), end).isoformat()})
            if not isinstance(rows, list):
                raise ValueError("unexpected candles payload")
            for row in rows:
                d = round((row[0] - GENESIS_EPOCH) / DAY_S)
                c = float(row[4])
                if c > 0:
                    closes[d] = c
            t += timedelta(days=300)
        if len(closes) >= 200:
            return sorted(closes.items())
    except Exception:
        pass
    try:
        j = get_json("https://api.kraken.com/0/public/OHLC",
                     params={"pair": "XBTUSD", "interval": 1440})
        res = j["result"]
        key = next(k for k in res if k != "last")
        out = []
        for row in res[key]:
            d = round((row[0] - GENESIS_EPOCH) / DAY_S)
            c = float(row[4])
            if c > 0:
                out.append((d, c))
        out.sort()
        if len(out) >= 200:
            return out
    except Exception:
        pass
    fail("daily closes unavailable from Coinbase and Kraken")


def fetch_cycle_extremes():
    """The current halving cycle's extremes from Yahoo Finance's
    BTC-USD daily OHLC: the cycle top (highest intraday high and
    highest close since the 2024-04-20 halving) and the bottom of
    the decline from that top (lowest intraday low and lowest close
    since the top's day). Dates carry their cycle day, the halving
    day itself counting as day 1 — the Spiral's own counting. Any
    Yahoo failure or implausible payload fails the run, like every
    other feed here."""
    start = datetime(CYCLE_HALVING.year, CYCLE_HALVING.month,
                     CYCLE_HALVING.day, tzinfo=timezone.utc)
    end = datetime.now(timezone.utc) + timedelta(days=1)
    try:
        j = get_json(
            "https://query1.finance.yahoo.com/v8/finance/chart/BTC-USD",
            params={"period1": int(start.timestamp()),
                    "period2": int(end.timestamp()),
                    "interval": "1d"})
        result = j["chart"]["result"][0]
        stamps = result["timestamp"]
        quote = result["indicators"]["quote"][0]
        rows = []
        for t, hi, lo, cl in zip(stamps, quote["high"], quote["low"],
                                 quote["close"]):
            if hi is None or lo is None or cl is None:
                continue
            hi, lo, cl = float(hi), float(lo), float(cl)
            if hi > 0 and lo > 0 and cl > 0:
                rows.append((datetime.fromtimestamp(t, timezone.utc).date(),
                             hi, lo, cl))
    except Exception as exc:
        fail("Yahoo cycle extremes unavailable: %s" % exc)
    rows.sort()
    today_utc = datetime.now(timezone.utc).date()
    if (len(rows) < 400 or rows[0][0] != CYCLE_HALVING
            or rows[-1][0] < today_utc - timedelta(days=2)):
        fail("implausible Yahoo cycle extremes payload: %d rows, "
             "%s to %s" % (len(rows),
                           rows[0][0] if rows else None,
                           rows[-1][0] if rows else None))
    top_high = max(rows, key=lambda r: r[1])
    top_close = max(rows, key=lambda r: r[3])
    since_top = [r for r in rows if r[0] >= top_close[0]]
    bottom_low = min(since_top, key=lambda r: r[2])
    bottom_close = min(since_top, key=lambda r: r[3])
    for v in (top_high[1], top_close[3], bottom_low[2], bottom_close[3]):
        if not (1000 < v < 10_000_000):
            fail("implausible cycle extreme %r" % v)

    def cyc_day(d):
        return (d - CYCLE_HALVING).days + 1

    return {
        "source": "Yahoo Finance BTC-USD daily OHLC",
        "halving": str(CYCLE_HALVING),
        "top": {
            "high": round(top_high[1], 2),
            "high_date": str(top_high[0]),
            "high_day": cyc_day(top_high[0]),
            "close": round(top_close[3], 2),
            "close_date": str(top_close[0]),
            "close_day": cyc_day(top_close[0]),
        },
        "bottom": {
            "basis": "since the cycle top",
            "low": round(bottom_low[2], 2),
            "low_date": str(bottom_low[0]),
            "low_day": cyc_day(bottom_low[0]),
            "close": round(bottom_close[3], 2),
            "close_date": str(bottom_close[0]),
            "close_day": cyc_day(bottom_close[0]),
        },
    }


GENESIS_EPOCH = 1230940800  # 2009-01-03T00:00:00Z, in seconds


def fetch_difficulty_t():
    """Current difficulty in trillions, from mempool.space — the page's
    own live source. Returns None when the feed is down; the caller
    then stands on the last baked difficulty, as the page does."""
    try:
        j = get_json("https://mempool.space/api/v1/mining/hashrate/3d")
        cur = float(j["currentDifficulty"])
        if cur > 0:
            return cur / 1e12
    except Exception:
        pass
    return None


def fetch_mvrv_rows():
    """CoinMetrics community API: daily market cap + MVRV ratio +
    closing price from 2010 onward, the page's own feed and request.
    Returns (rows, prices): rows is a sorted list of (day, market
    cap, MVRV ratio); prices maps day -> closing price (USD)."""
    j = get_json(
        "https://community-api.coinmetrics.io/v4/timeseries/asset-metrics",
        params={"assets": "btc",
                "metrics": "CapMrktCurUSD,CapMVRVCur,PriceUSD",
                "frequency": "1d",
                "page_size": 10000,
                "start_time": "2010-01-01T00:00:00.000Z",
                "sort": "time"})
    rows = []
    prices = {}
    for row in j.get("data") or []:
        try:
            y, m, d = str(row["time"])[:10].split("-")
            day = (date(int(y), int(m), int(d)) - GENESIS).days
            mv = float(row["CapMrktCurUSD"])
            ratio = float(row["CapMVRVCur"])
        except (KeyError, ValueError, TypeError):
            continue
        if mv > 0 and ratio > 0:
            rows.append((day, mv, ratio))
        try:
            p = float(row["PriceUSD"])
        except (KeyError, ValueError, TypeError):
            continue
        if p > 0:
            prices[day] = p
    rows.sort()
    # The page's own guard: anything short of the full, from-the-start
    # history is not this gauge — the baked figures stand there, and
    # here the previous state file stands.
    if len(rows) < 4000 or rows[0][0] > 600:
        fail("CoinMetrics history incomplete (%d rows)" % len(rows))
    if len(prices) < 4000 or min(prices) > 600:
        fail("CoinMetrics price history incomplete (%d rows)"
             % len(prices))
    return rows, prices


def fetch_tail_diffs(first_day, last_day):
    """Best-effort difficulty history for the score series' tail
    past the page's baked grid: {day: difficulty in trillions} from
    mempool.space's difficulty-adjustment history — this script's
    own difficulty source. Difficulty is constant inside an
    adjustment period, so a day takes the difficulty set by the
    latest adjustment on or before that day. Any failure returns
    {} and the series ends at the grid's edge, exactly as it did
    before the tail existed — but the failure is retried, then
    reported loudly on stderr, and the completeness guard in
    score_series refuses to publish when the truncation matters
    (2026-11-23: this fetch failed once in the runner, the old
    silent {} ended the series at the grid's edge ten days early,
    and the truncated record shipped without a trace)."""
    periods = None
    last_exc = None
    for attempt in range(3):
        try:
            adj = get_json(
                "https://mempool.space/api/v1/mining/"
                "difficulty-adjustments")
            periods = []
            for row in adj:
                ts, raw = float(row[0]), float(row[2])
                day = (datetime.fromtimestamp(ts, timezone.utc).date()
                       - GENESIS).days
                if raw > 0:
                    periods.append((day, raw / 1e12))
            periods.sort()
            break
        except Exception as exc:
            last_exc = exc
            periods = None
            if attempt < 2:
                time.sleep(2 + 4 * attempt)
    if not periods:
        print("update_btc_state: WARNING: difficulty-adjustment "
              "history unreadable after 3 attempts (%s); the score "
              "series will end at the baked grid's edge"
              % last_exc, file=sys.stderr)
        return {}
    out = {}
    cur = None
    pi = 0
    for day in range(first_day, last_day + 1):
        while pi < len(periods) and periods[pi][0] <= day:
            cur = periods[pi][1]
            pi += 1
        if cur is not None:
            out[day] = cur
    return out


# --------------------------------------------------------------------- readings

def reading_powerlaw(today, price):
    fair = 10 ** (PL_A + PL_N * math.log10(today))
    floor = fair * PL_LO
    ceil = fair * PL_HI
    pos = (math.log10(price) - math.log10(floor)) / \
          (math.log10(ceil) - math.log10(floor)) * 100
    # the page's zone dist: (SPOT.price / fl - 1) * 100
    pct = (price / floor - 1) * 100
    # "_top" is private: the top-state test on the UNROUNDED position,
    # popped by main() before the state is written — the published
    # reading carries only pos / band / pct, as before.
    return {"pos": round(pos, 2), "band": band_of_pos(pos),
            "pct": round(pct, 4), "_top": pos >= 95, "_pos": pos}


def reading_cost(today, price, inputs, peak, diff_t):
    c = cost_for(today, diff_t, inputs["fees"][-1], inputs["eff"], inputs["sub"])
    pos = (price / c - 1) / (peak - 1) * 100
    # the page's zone dist is its readout devPct: (SPOT.price / c - 1) * 100
    pct = (price / c - 1) * 100
    # "_top" is private, as in reading_powerlaw: the top-state test
    # on the UNROUNDED ratio (price / cost of production) — a
    # threshold, not the position (see COST_TOP_RATIO).
    return {"pos": round(pos, 2), "band": band_of_pos(pos),
            "pct": round(pct, 4), "_top": price / c >= COST_TOP_RATIO,
            "_ratio": price / c}


def reading_mayer(today, price, closes):
    pts = [(d, c) for d, c in closes if d <= today]
    pts = [(d, c) for d, c in pts if d < today]
    pts.append((today, float(price)))
    if len(pts) < 200:
        fail("fewer than 200 closes for the Mayer average")
    window = [c for _, c in pts[-200:]]
    ratio = price / (sum(window) / 200)
    band = "green" if ratio <= 1 else ("red" if ratio >= 2.4 else "yellow")
    # the page's zone dist: (last[1] - 1) * 100, from the unrounded ratio
    return {"ratio": round(ratio, 4), "band": band,
            "pct": round((ratio - 1) * 100, 4), "_ratio": ratio}


def reading_mvrv(rows):
    # Welford running standard deviation of market cap over the full
    # history; Z from the 200th day on — the page's rebuild, verbatim.
    n = 0
    mean = 0.0
    m2 = 0.0
    last = None
    for i, (day, mv, ratio) in enumerate(rows):
        rv = mv / ratio
        n += 1
        delta = mv - mean
        mean += delta / n
        m2 += delta * (mv - mean)
        if i >= 199:
            std = math.sqrt(m2 / n)
            if std > 0:
                last = (day, (mv - rv) / std, ratio)
    if last is None:
        fail("MVRV series too short")
    day, z, ratio = last
    band = "green" if ratio <= 1.15 else ("red" if z >= 7 else "yellow")
    # the page's zone dist: (last[2] / last[3] - 1) * 100, market cap
    # over realized cap — which is the CoinMetrics ratio itself, minus 1
    return {"z": round(z, 4), "band": band,
            "pct": round((ratio - 1) * 100, 4), "_z": z}, day


# -------------------------------------------------------------------- record

def record_facts(inputs, peak, golden_now, top_now):
    """The rarity record over the page's baked weekly series: the
    Mayer block's BAKED sample days are the grid; power law and
    production cost are carried from their 4-day grid (the sample's
    own grid cell), MVRV is last-value-carried-forward from its
    baked rows — the rarity measurement's grid and each model's own
    lines, so the counts are the measured ones. Returns {"weeks",
    "golden_weeks", "top_weeks", "last_golden_end", "last_top_end"}
    with the ends as ISO dates (None when no completed episode of
    that kind exists)."""
    mayer = inputs["mayer_baked"]
    mvrv = inputs["mvrv_baked"]
    prices, diff, fees = inputs["prices"], inputs["diff"], inputs["fees"]
    eff, sub = inputs["eff"], inputs["sub"]

    def mvrv_zr(day):
        z = ratio = None
        for row in mvrv:
            if row[0] <= day:
                z = row[1]
                ratio = row[2] / row[3]
            else:
                break
        return z, ratio

    def episodes(flags):
        eps, cur = [], None
        for day, on in flags:
            if on:
                if cur is None:
                    cur = [day, day]
                cur[1] = day
            elif cur is not None:
                eps.append(cur)
                cur = None
        if cur is not None:
            eps.append(cur)
        return eps

    golden_flags, top_flags = [], []
    for row in mayer:
        day, mult = row[0], row[1]
        gi = min(len(prices) - 1,
                 max(0, (day - GRID_START) // GRID_STEP))
        gd = GRID_START + gi * GRID_STEP
        price = prices[gi]
        ratio = price / cost_for(gd, diff[gi], fees[gi], eff, sub)
        fair = 10 ** (PL_A + PL_N * math.log10(gd))
        pos_pl = (math.log10(price) - math.log10(fair * PL_LO)) \
            / math.log10(PL_HI / PL_LO) * 100
        pos_cost = (ratio - 1) / (peak - 1) * 100
        z, mvrv_ratio = mvrv_zr(day)
        golden_flags.append((day, pos_pl <= 5 and pos_cost <= 5
                             and mult <= 1.0
                             and mvrv_ratio is not None
                             and mvrv_ratio <= 1.15))
        top_flags.append((day, pos_pl >= 95
                          and ratio >= COST_TOP_RATIO
                          and mult >= 2.4
                          and z is not None and z >= 7))

    def last_completed_end(eps, live_now):
        if not eps:
            return None
        # A run that reaches the final sample while the same state
        # is live today may still be running — not completed; the
        # previous episode's end stands.
        if eps[-1][1] == mayer[-1][0] and live_now:
            if len(eps) < 2:
                return None
            return str(GENESIS + timedelta(days=eps[-2][1]))
        return str(GENESIS + timedelta(days=eps[-1][1]))

    return {
        "weeks": len(mayer),
        "golden_weeks": sum(1 for _, on in golden_flags if on),
        "top_weeks": sum(1 for _, on in top_flags if on),
        "last_golden_end": last_completed_end(episodes(golden_flags),
                                              golden_now),
        "last_top_end": last_completed_end(episodes(top_flags),
                                           top_now),
    }


def score_record_facts(inputs, peak, buy_now, sell_now):
    """The score's own rarity record over the same baked weekly
    series and the same grid rules as record_facts: each sample
    week's four raw values (power-law position and cost ratio from
    the sample's own 4-day grid cell, the Mayer Multiple at the
    sample day, the MVRV Z-Score last-value-carried-forward) are
    scaled and averaged by score_parts / score_value, and the week
    counts for a band when its score is inside that band. Returns
    {"weeks", "buy_weeks", "sell_weeks", "last_buy_end",
    "last_sell_end"} with the ends under the same completed-episode
    rule as record_facts."""
    mayer = inputs["mayer_baked"]
    mvrv = inputs["mvrv_baked"]
    prices, diff, fees = inputs["prices"], inputs["diff"], inputs["fees"]
    eff, sub = inputs["eff"], inputs["sub"]

    def mvrv_z(day):
        z = None
        for row in mvrv:
            if row[0] <= day:
                z = row[1]
            else:
                break
        return z

    def episodes(flags):
        eps, cur = [], None
        for day, on in flags:
            if on:
                if cur is None:
                    cur = [day, day]
                cur[1] = day
            elif cur is not None:
                eps.append(cur)
                cur = None
        if cur is not None:
            eps.append(cur)
        return eps

    buy_flags, sell_flags = [], []
    for row in mayer:
        day, mult = row[0], row[1]
        gi = min(len(prices) - 1,
                 max(0, (day - GRID_START) // GRID_STEP))
        gd = GRID_START + gi * GRID_STEP
        price = prices[gi]
        ratio = price / cost_for(gd, diff[gi], fees[gi], eff, sub)
        fair = 10 ** (PL_A + PL_N * math.log10(gd))
        pos_pl = (math.log10(price) - math.log10(fair * PL_LO)) \
            / math.log10(PL_HI / PL_LO) * 100
        z = mvrv_z(day)
        if z is None:
            buy_flags.append((day, False))
            sell_flags.append((day, False))
            continue
        score = score_value(score_parts(pos_pl, ratio, mult, z))
        buy_flags.append((day, score <= SCORE_BUY))
        sell_flags.append((day, score >= SCORE_SELL))

    def last_completed_end(eps, live_now):
        if not eps:
            return None
        if eps[-1][1] == mayer[-1][0] and live_now:
            if len(eps) < 2:
                return None
            return str(GENESIS + timedelta(days=eps[-2][1]))
        return str(GENESIS + timedelta(days=eps[-1][1]))

    return {
        "weeks": len(mayer),
        "buy_weeks": sum(1 for _, on in buy_flags if on),
        "sell_weeks": sum(1 for _, on in sell_flags if on),
        "last_buy_end": last_completed_end(episodes(buy_flags),
                                           buy_now),
        "last_sell_end": last_completed_end(episodes(sell_flags),
                                            sell_now),
    }


def score_series(inputs, peak, prices, mvrv_rows, tail_diffs):
    """The combined score's full daily history: one [ISO date,
    score] pair per day, each score rounded to 2 decimals, from the
    first day all four models have a reading (2011-02-02) to the
    latest day in the feeds. The construction is the measured test
    pipeline's, day for day (btc-averaged-score / the overlay v2
    proof): the MVRV Z-Score from the running standard deviation of
    market cap built up over the full CoinMetrics history (Welford,
    the page's rebuild), taken from the 200th row on; the Mayer
    Multiple against the trailing 200 daily closes including the
    day itself, taken from the 200th close on; the power-law
    position from the day's closing price; the production cost from
    the day's own 4-day grid cell of the page's baked inputs — or,
    past the grid's last cell, from the day's difficulty in
    tail_diffs with the last baked fees standing in, the page's own
    live-tail method. A day missing any one of the four readings is
    not published — the series holds only days the score was fully
    measured."""
    mvrv_z = {}
    n = 0
    mean = 0.0
    m2 = 0.0
    for i, (day, mv, ratio) in enumerate(mvrv_rows):
        rv = mv / ratio
        n += 1
        delta = mv - mean
        mean += delta / n
        m2 += delta * (mv - mean)
        if i >= 199:
            std = math.sqrt(m2 / n)
            if std > 0:
                mvrv_z[day] = (mv - rv) / std

    price_days = sorted(prices)
    mayer = {}
    run = 0.0
    for i, day in enumerate(price_days):
        run += prices[day]
        if i >= 200:
            run -= prices[price_days[i - 200]]
        if i >= 199:
            mayer[day] = prices[day] / (run / 200.0)

    diff, fees = inputs["diff"], inputs["fees"]
    eff, sub = inputs["eff"], inputs["sub"]
    out = []
    for day in range(price_days[0], price_days[-1] + 1):
        if day not in prices or day not in mayer or day not in mvrv_z:
            continue
        if day < GRID_START:
            continue
        gi = (day - GRID_START) // GRID_STEP
        if gi < len(diff):
            cost = cost_for(day, diff[gi], fees[gi], eff, sub)
        elif day in tail_diffs:
            cost = cost_for(day, tail_diffs[day], fees[-1], eff, sub)
        else:
            continue
        price = prices[day]
        fair = 10 ** (PL_A + PL_N * math.log10(day))
        pos_pl = (math.log10(price) - math.log10(fair * PL_LO)) \
            / math.log10(PL_HI / PL_LO) * 100
        ratio = price / cost
        s = score_value(score_parts(pos_pl, ratio, mayer[day],
                                    mvrv_z[day]))
        out.append([str(GENESIS + timedelta(days=day)),
                    round(s, 2)])
    if len(out) < 5000:
        fail("score series implausibly short (%d days)" % len(out))
    # Completeness guard: the series must reach the feeds' latest
    # day, or stop within two days of it. A longer gap means an
    # input silently gave up — the tail difficulty history is the
    # known case (2026-11-23, above) — and a truncated record must
    # never ship: fail loudly and let the previously published
    # state stand until a complete run lands.
    last_day = (date.fromisoformat(out[-1][0]) - GENESIS).days
    if price_days[-1] - last_day > 2:
        fail("score series ends %s, %d days before the latest feed "
             "day %s — refusing to publish a truncated record"
             % (out[-1][0], price_days[-1] - last_day,
                str(GENESIS + timedelta(days=price_days[-1]))))
    return out


# ------------------------------------------------------------- share snapshot
# og-bitcoin.jpg: the page's power-law chart card, composed for the
# 1200x630 share frame from the SAME state dict and baked inputs as
# btc-state.json. The drawing ports the page's own canvas code
# (bitcoin.html, btc-pl-code): the full-range log-log view (log10 days
# 2..4, log10 price -2..7), the corridor fill, the dashed support /
# ceiling bands, the white trend (solid to today, dashed projected),
# the orange price line, the red buy-zone markers, and the today dot
# with its red zone ring when the price sits at or under the floor.
# The stats row uses the page's own formats (spot exact; fair, floor
# and ceiling rounded to the nearest $100; the deviation as a whole
# percent). The price line is the page's baked 4-day series plus the
# state's spot point — the page's live tail of daily closes is the
# one thing a nightly snapshot cannot carry, and the dated label
# says so by saying when this is.

_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
           "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def _fmt_date(d):
    """'Nov 18, 2026' — the page's dateStr form."""
    return "%s %d, %d" % (_MONTHS[d.month - 1], d.day, d.year)


def _js_round(v):
    """JavaScript Math.round for the (positive) values used here."""
    return math.floor(v + 0.5)


def _money(v):
    """The page's money(): $ with thousands separators at $1,000+."""
    if v >= 1000:
        return "$" + format(int(_js_round(v)), ",")
    if v >= 1:
        return "$" + ("%.2f" % v).rstrip("0").rstrip(".")
    return "$" + "%.2f" % v


def _tick_label(v):
    """The page's tickLabel() for the y axis."""
    def trim(x):
        s = "%.1f" % (_js_round(x * 10) / 10.0)
        return s[:-2] if s.endswith(".0") else s
    if v >= 1e6:
        return "$" + trim(v / 1e6) + "M"
    if v >= 1e3:
        return "$" + trim(v / 1e3) + "K"
    if v >= 100:
        return "$" + str(int(_js_round(v)))
    if v >= 10:
        return "$" + trim(v)
    if v >= 1:
        return "$" + ("%.2f" % v).rstrip("0").rstrip(".")
    return "$" + "%.2f" % v


def snapshot_stats(state):
    """Every number the snapshot prints, from the state alone.
    Returns the printed strings plus the raw values, so a check can
    prove the image and btc-state.json tell the same story."""
    asof = datetime.strptime(state["as_of"], "%Y-%m-%dT%H:%M:%SZ")
    day = (asof.date() - GENESIS).days
    price = state["price"]
    fv = 10 ** (PL_A + PL_N * math.log10(day))
    fl, ce = fv * PL_LO, fv * PL_HI
    dev = (price / fv - 1) * 100
    r100 = lambda v: _js_round(v / 100) * 100
    return {
        "day": day, "date": _fmt_date(asof.date()), "price": price,
        "fair": fv, "floor": fl, "ceil": ce, "dev": dev,
        "spot_s": _money(price),
        "fair_s": _money(r100(fv)),
        "floor_s": _money(r100(fl)),
        "ceil_s": _money(r100(ce)),
        "dev_s": "%d%% %s trend" % (_js_round(abs(dev)),
                                    "below" if dev < 0 else "above"),
        "dev_note": "undervalued vs. the model" if dev < 0
                    else "stretched vs. the model",
        "callout": ("Rare buy — the combined score is in "
                    "its buy band." if state.get("golden")
                    else "Rare sell — the combined score is in "
                         "its sell band." if state.get("top") else None),
    }


def render_snapshot(state, inputs, out_path=OG_PATH):
    """Draw og-bitcoin.jpg from the state dict + the page's baked
    inputs. Returns snapshot_stats(state) — what was printed."""
    from PIL import Image, ImageDraw, ImageFont

    st = snapshot_stats(state)
    day, price = st["day"], st["price"]
    fair = lambda d: 10 ** (PL_A + PL_N * math.log10(d))

    S = 2  # supersample: draw at 2x, downscale for clean lines
    W, H = 1200 * S, 630 * S
    BG = (7, 9, 14)            # the site's dark --bg-color, #07090e
    TEXT = (240, 243, 246)     # --text-color
    MUTED = (148, 163, 184)    # #94a3b8, the chart's own label grey
    ORANGE = (247, 147, 26)    # #f7931a, the price line
    WHITE = (241, 245, 249)    # #f1f5f9, the trend line
    GREEN = (34, 197, 94)      # #22c55e, support
    RED = (239, 68, 68)        # #ef4444, ceiling / zone
    GOLD = (212, 175, 55)      # #d4af37, the golden callout

    def font(sz, bold=False):
        name = "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"
        try:
            return ImageFont.truetype("/usr/share/fonts/truetype/dejavu/" + name, sz * S)
        except OSError:
            return ImageFont.truetype(name, sz * S)

    img = Image.new("RGB", (W, H), BG)
    dr = ImageDraw.Draw(img)

    def blend(draw_fn, alpha):
        layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        draw_fn(ImageDraw.Draw(layer), alpha)
        img.paste(Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB"), (0, 0))
        return ImageDraw.Draw(img)

    MX = 40 * S
    # ---- stats row (the page's five readouts, its own formats) ----
    cols = [(MX, "SPOT", st["spot_s"], st["date"]),
            (MX + 175 * S, "FAIR VALUE (TREND)", st["fair_s"], "model, today"),
            (MX + 410 * S, "VS. TREND", st["dev_s"], st["dev_note"]),
            (MX + 715 * S, "SUPPORT FLOOR", st["floor_s"], "−2σ band"),
            (MX + 930 * S, "CEILING", st["ceil_s"], "+2σ band")]
    f_lab, f_val, f_note = font(14, True), font(30, True), font(13)
    for x, lab, val, note in cols:
        dr.text((x, 30 * S), lab, font=f_lab, fill=MUTED)
        dr.text((x, 54 * S), val, font=f_val, fill=TEXT)
        dr.text((x, 96 * S), note, font=f_note, fill=MUTED)
    # ---- the dated-snapshot line ----
    f_date = font(14)
    tag = "Snapshot · " + st["date"]
    tw = dr.textlength(tag, font=f_date)
    dr.text((W - MX - tw, 128 * S), tag, font=f_date, fill=MUTED)
    # ---- golden / top callout, when a state is active ----
    cy_top = 148 * S
    if st["callout"]:
        col = GOLD if state.get("golden") else RED
        f_call = font(17, True)
        cw = dr.textlength(st["callout"], font=f_call)
        dr.text(((W - cw) / 2, 122 * S), st["callout"], font=f_call, fill=col)
        cy_top = 182 * S

    # ---- the chart (the page's full-range view and geometry) ----
    VX0, VX1, VY0, VY1 = 2.0, 4.0, -2.0, 7.0
    padL, padR, padT, padB = 64 * S, 14 * S, 14 * S, 28 * S
    cx0, cy0 = MX, cy_top
    cw_, ch_ = W - 2 * MX, 594 * S - cy_top
    iw, ih = cw_ - padL - padR, ch_ - padT - padB
    X = lambda d: cx0 + padL + (math.log10(d) - VX0) / (VX1 - VX0) * iw
    Y = lambda p: cy0 + padT + (VY1 - math.log10(p)) / (VY1 - VY0) * ih

    f_ax = font(11)
    # grid + y labels: whole decades, as the page's zoomed-out step
    def grid(d, a):
        for k in range(-2, 8):
            y = Y(10 ** k)
            col = (148, 163, 184, a if k % 1 == 0 else a)
            d.line([(cx0 + padL, y), (cx0 + cw_ - padR, y)],
                   fill=(148, 163, 184, 41 if k != -2 else 41), width=S)
        for yr in range(2010, 2037):
            dd = (date(yr, 1, 1) - GENESIS).days
            if 10 ** VX0 <= dd <= 10 ** VX1:
                x = X(dd)
                d.line([(x, cy0 + padT), (x, cy0 + ch_ - padB)],
                       fill=(148, 163, 184, 31), width=S)
    dr = blend(grid, 41)
    for k in range(-2, 8):
        y = Y(10 ** k)
        lab = _tick_label(10 ** k)
        lw_ = dr.textlength(lab, font=f_ax)
        dr.text((cx0 + padL - 8 * S - lw_, y - 6 * S), lab, font=f_ax, fill=MUTED)
    last_x = -10 ** 9
    for yr in range(2010, 2037):
        dd = (date(yr, 1, 1) - GENESIS).days
        if not (10 ** VX0 <= dd <= 10 ** VX1):
            continue
        x = X(dd)
        if x - last_x >= 56 * S:
            s = str(yr)
            lw_ = dr.textlength(s, font=f_ax)
            dr.text((x - lw_ / 2, cy0 + ch_ - padB + 8 * S), s, font=f_ax, fill=MUTED)
            last_x = x

    def dashed(pts, color, width, dash, gap):
        on = True
        left = dash
        for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
            seg = math.hypot(x2 - x1, y2 - y1)
            t = 0.0
            while t < seg:
                step = min(left, seg - t)
                if on:
                    a = (x1 + (x2 - x1) * t / seg, y1 + (y2 - y1) * t / seg)
                    b = (x1 + (x2 - x1) * (t + step) / seg, y1 + (y2 - y1) * (t + step) / seg)
                    dr.line([a, b], fill=color, width=width)
                t += step
                left -= step
                if left <= 0:
                    on = not on
                    left = dash if on else gap
            if seg == 0:
                continue

    def samples(a, b, n):
        f = (b / a) ** (1.0 / n)
        out, d = [a], a
        for _ in range(n - 1):
            d *= f
            out.append(d)
        out.append(b)
        return out

    dmin, dmax = 10 ** VX0, 10 ** VX1
    # corridor fill between the bands
    def fill_fn(d, a):
        top = [(X(x), Y(fair(x) * PL_HI)) for x in samples(dmin, dmax, 120)]
        bot = [(X(x), Y(fair(x) * PL_LO)) for x in samples(dmax, dmin, 120)]
        d.polygon(top + bot, fill=(247, 147, 26, 13))
    dr = blend(fill_fn, 13)
    # bands, trend (solid to today, dashed projected), price
    dashed([(X(x), Y(fair(x) * PL_HI)) for x in samples(dmin, dmax, 240)], RED, 3, 10 * S // 2, 8 * S // 2)
    dashed([(X(x), Y(fair(x) * PL_LO)) for x in samples(dmin, dmax, 240)], GREEN, 3, 10 * S // 2, 8 * S // 2)
    solid = [(X(x), Y(fair(x))) for x in samples(dmin, min(dmax, day), 240)]
    dr.line(solid, fill=WHITE, width=2 * S, joint="curve")
    if dmax > day:
        dashed([(X(x), Y(fair(x))) for x in samples(max(dmin, day), dmax, 240)], WHITE, 2 * S, 8 * S // 2, 8 * S // 2)
    pts = [(X(GRID_START + i * GRID_STEP), Y(p))
           for i, p in enumerate(inputs["prices"])]
    pts.append((X(day), Y(price)))
    dr.line(pts, fill=ORANGE, width=2 * S, joint="curve")
    # buy-zone markers: baked points at or under the floor
    r = 3.5 * S
    for i, p in enumerate(inputs["prices"]):
        dd = GRID_START + i * GRID_STEP
        if p <= fair(dd) * PL_LO:
            x, y = X(dd), Y(p)
            dr.ellipse([x - r, y - r, x + r, y + r], fill=RED, outline=(255, 255, 255), width=S + S // 2)
    # today dot (+ red zone ring when at or under the floor)
    tx, ty = X(day), Y(price)
    R = 6 * S
    dr.ellipse([tx - R, ty - R, tx + R, ty + R], fill=ORANGE, outline=(255, 255, 255), width=2 * S)
    if price <= fair(day) * PL_LO:
        R2 = 8.5 * S
        dr.ellipse([tx - R2, ty - R2, tx + R2, ty + R2], outline=RED, width=5 * S // 2)
    f_today = font(15, True)
    label = "Today " + _money(price)
    lw_ = dr.textlength(label, font=f_today)
    if tx > cx0 + cw_ - 170 * S:
        dr.text((tx - 12 * S - lw_, ty - 26 * S), label, font=f_today, fill=WHITE)
    else:
        dr.text((tx + 12 * S, ty - 26 * S), label, font=f_today, fill=WHITE)

    dr.rectangle([0, 0, W - 1, H - 1], outline=(35, 40, 51), width=S)
    img = img.resize((1200, 630), Image.LANCZOS)
    img.save(out_path, "JPEG", quality=90)
    return st


# -------------------------------------------------------------------------
# og-bitcoin.jpg as a TRUE CAPTURE of the page's own chart section.
#
# Johnny's ruling (2026-11-22): the picture in the alert email must
# BE his graph — the chart section of bitcoin.html exactly as the
# page draws it — not render_snapshot()'s imitation above, whose
# words and treatment drifted from the page (its strip read
# "FAIR VALUE (TREND)" / "VS. TREND" / "SUPPORT FLOOR" where the
# page reads "Typical price" / "Vs. typical price" / "Floor"; it
# invented a gold callout line and a "Snapshot ·" caption the page
# section does not carry; its markers were its own invention, not
# the page overlay's dots; and its price line was the baked grid
# alone, where the page appends live daily closes). So the run now
# serves this repo locally, opens bitcoin.html in headless Chrome,
# and screenshots the chart section's own elements — the numbers
# strip and the chart panel — framed to the 1200x630 share size.
#
# The captured state is the email's state, as Johnny settled it
# (2026-11-22): the Power Law view (CAPTURE_VIEW — switching the
# view is a one-line change), the indicator OVERLAY ON, set
# through the page's own switch (#btcOvlBtn) so the dots on the
# chart are the page's own combined-score band-day dots, and the
# view window zoomed to roughly the last four years — one halving
# cycle's journey: the 2022 bottom, the 2025 top, the fall, and
# today's buy run at the floor — at an email-readable size.
#
# The window is set through the chart's OWN view state. The
# capture serves a copy of the page whose power-law code block
# carries one added line exposing a setter for its real
# VX0/VX1/VY0/VY1 variables; the setter assigns them and calls
# the chart's own clampView() + draw(), so the axes, ticks and
# lines are drawn by the chart itself for that window — never a
# CSS crop of the full-history render. bitcoin.html on disk is
# never modified: the hook exists only in the served copy, only
# for this screenshot. If the chart code changes so the hook's
# anchor line is gone, the capture fails safe (see below).
#
# Truth guard: the page finishes its chart from live Coinbase /
# Kraken data (daily closes + the spot). The capture proceeds
# only once the strip's Spot carries the state's own date and
# matches the state's price within 2% — the picture can never
# silently disagree with the numbers the same run publishes.
# Any failure at any step keeps the previous og-bitcoin.jpg and
# the run still succeeds; render_snapshot() runs only when no
# og-bitcoin.jpg exists yet.

CAPTURE_VIEW = os.environ.get("BTC_CAPTURE_VIEW", "powerlaw")

_CAPTURE_VIEWS = {
    # view -> the page elements that make up its chart section.
    # "spot"/"note" name the readout's live-spot stat, used by the
    # truth guard; the MVRV readout carries no spot stat.
    "powerlaw": {"button": "powerlaw", "wrap": "#btc-view-powerlaw",
                 "readout": "#pl-readout", "spot": "#pl-spot",
                 "note": "#pl-spot-date"},
    "cost": {"button": "cost", "wrap": "#btc-view-cost",
             "readout": "#pc-readout", "spot": "#pc-spot",
             "note": "#pc-spot-date"},
    "mayer": {"button": "mayer", "wrap": "#btc-view-mayer",
              "readout": "#mm-readout", "spot": "#mm-spot",
              "note": "#mm-spot-date"},
    "mvrv": {"button": "mvrv", "wrap": "#btc-view-mvrv",
             "readout": "#mv-readout", "spot": None, "note": None},
}

_PL_VIEW_ANCHOR = "var VX0 = X0, VX1 = X1, VY0 = Y0, VY1 = Y1;"


def _capture_window(state, inputs):
    """The email's Power Law window (Johnny, 2026-11-22): roughly
    the last four years. Returns (vx0, vx1, vy0, vy1) in the
    chart's own log10 space — x from four years before the state's
    day to that day plus headroom; y fitted to the window's own
    price journey (the page's baked grid + the state's spot) with
    headroom at both ends."""
    asof = datetime.strptime(state["as_of"], "%Y-%m-%dT%H:%M:%SZ")
    last_day = (asof.date() - GENESIS).days
    first_day = last_day - 1461  # four years, the leap day included
    lo = hi = None
    for i, p in enumerate(inputs["prices"]):
        d = GRID_START + i * GRID_STEP
        if first_day <= d <= last_day:
            lo = p if lo is None else min(lo, p)
            hi = p if hi is None else max(hi, p)
    if lo is None:
        raise ValueError("no baked prices inside the capture window")
    lo = min(lo, float(state["price"]))
    hi = max(hi, float(state["price"]))
    return (math.log10(first_day), math.log10(last_day + 183),
            math.log10(lo) - 0.14, math.log10(hi) + 0.19)


def _inject_pl_view_hook(page_text):
    """The served copy of the page with the view setter added to
    the power-law code block (see the section note above). Returns
    None when the block or its anchor line is not found exactly
    once — the capture then fails safe rather than guessing."""
    marker = 'id="btc-pl-code"'
    start = page_text.find(marker)
    if start < 0:
        return None
    end = page_text.find("</script>", start)
    if end < 0:
        return None
    block = page_text[start:end]
    if block.count(_PL_VIEW_ANCHOR) != 1:
        return None
    hook = (_PL_VIEW_ANCHOR + "\n        window.__plSetView = "
            "function (x0, x1, y0, y1) { VX0 = x0; VX1 = x1; "
            "VY0 = y0; VY1 = y1; clampView(); draw(); "
            "return [VX0, VX1, VY0, VY1]; };")
    return page_text[:start] + block.replace(_PL_VIEW_ANCHOR, hook) \
        + page_text[end:]


def _capture_serve(site_dir, page_bytes):
    """Serve site_dir on a loopback port, with bitcoin.html coming
    from page_bytes (the possibly-hooked copy) instead of disk."""
    import http.server
    import threading

    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=site_dir, **kwargs)

        def do_GET(self):
            if self.path.split("?")[0] in ("/", "/bitcoin.html"):
                self.send_response(200)
                self.send_header("Content-Type",
                                 "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(page_bytes)))
                self.end_headers()
                self.wfile.write(page_bytes)
                return
            super().do_GET()

        def log_message(self, *args):
            pass

    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def _capture_launch(pw):
    """Headless Chrome, however this machine provides it: the
    Playwright bundle, the system Chrome channel, or a binary on
    a standard path — first success wins."""
    attempts = [{}, {"channel": "chrome"},
                {"executable_path": "/usr/bin/google-chrome"},
                {"executable_path": "/usr/bin/chromium"},
                {"executable_path": "/usr/bin/chromium-browser"}]
    last = None
    for kwargs in attempts:
        try:
            return pw.chromium.launch(**kwargs)
        except Exception as exc:
            last = exc
    raise RuntimeError("no launchable chromium: %s" % last)


def _capture_shot(state, inputs, view, cfg, port):
    """Drive the page to the email's chart state and screenshot
    the section (strip + chart panel) as PNG bytes. Raises on any
    failure; capture_snapshot() turns that into the safe path."""
    import io

    from PIL import Image
    from playwright.sync_api import sync_playwright

    asof = datetime.strptime(state["as_of"], "%Y-%m-%dT%H:%M:%SZ")
    want_label = _fmt_date(asof.date())
    wrap = cfg["wrap"]
    chart_sel = wrap + " .pl-chart-wrap"
    with sync_playwright() as pw:
        browser = _capture_launch(pw)
        try:
            page = browser.new_page(
                viewport={"width": 1280, "height": 900},
                device_scale_factor=2, color_scheme="dark")
            page.goto("http://127.0.0.1:%d/bitcoin.html" % port,
                      wait_until="load", timeout=60000)
            # The overlay's band data comes from the state file the
            # same run just wrote; wait until it has landed.
            page.wait_for_function("!!window.BTC_BANDS", timeout=30000)
            if cfg["button"] != "powerlaw":
                page.evaluate(
                    "document.querySelector('.btc-pick-opt[data-view="
                    "\"%s\"]').click()" % cfg["button"])
                page.wait_for_selector(chart_sel, state="visible",
                                       timeout=20000)
            if cfg["spot"]:
                # The truth guard: the strip's spot note carries
                # the state's own date only once the live tail has
                # replaced the baked figures — and the spot itself
                # must agree with the state's price.
                page.wait_for_function(
                    "([sel, label]) => { var el = "
                    "document.querySelector(sel); return el && "
                    "el.textContent.indexOf(label) >= 0; }",
                    arg=[cfg["note"], want_label], timeout=45000)
                spot_txt = page.text_content(cfg["spot"]) or ""
                spot_val = float(spot_txt.replace("$", "")
                                 .replace(",", "").strip())
                if abs(spot_val - state["price"]) > 0.02 * state["price"]:
                    raise ValueError(
                        "page spot %s disagrees with state price %s"
                        % (spot_txt, state["price"]))
            else:
                page.wait_for_function(
                    "sel => { var el = document.querySelector(sel); "
                    "return el && el.textContent.trim().length > 1; }",
                    arg=cfg["readout"] + " .pl-value", timeout=30000)
            # The overlay, through the page's own switch.
            if page.evaluate("window.BTC_OVERLAY") is not True:
                page.click("#btcOvlBtn", timeout=15000)
                page.wait_for_function("window.BTC_OVERLAY === true",
                                       timeout=10000)
            page.wait_for_timeout(400)  # the overlay's redraw settles
            if view == "powerlaw":
                win = _capture_window(state, inputs)
                page.evaluate(
                    "([a, b, c, d]) => window.__plSetView(a, b, c, d)",
                    arg=list(win))
                page.wait_for_timeout(250)
            # Frame the section: the strip at a fixed offset below
            # the viewport top (clear of the site header and the
            # pinned picker), the whole strip + chart in the shot.
            top = page.evaluate(
                "sel => document.querySelector(sel)"
                ".getBoundingClientRect().top + window.scrollY",
                arg=cfg["readout"])
            page.evaluate("y => window.scrollTo(0, y)", arg=top - 150)
            page.wait_for_timeout(200)
            rb = page.locator(cfg["readout"]).bounding_box()
            cb = page.locator(chart_sel).bounding_box()
            if not rb or not cb:
                raise ValueError("chart section elements not found")
            shot = page.screenshot()
            img = Image.open(io.BytesIO(shot))
            dsf = img.width / 1280.0
            x0 = int(min(rb["x"], cb["x"]) * dsf)
            y0 = int(rb["y"] * dsf)
            x1 = int(max(rb["x"] + rb["width"],
                         cb["x"] + cb["width"]) * dsf)
            y1 = int((cb["y"] + cb["height"]) * dsf)
            out = io.BytesIO()
            img.crop((x0, y0, x1, y1)).save(out, "PNG")
            return out.getvalue()
        finally:
            browser.close()


def _write_share_jpeg(png_bytes, out_path):
    """Frame the section shot to the 1200x630 share size: scale
    to width, pad with the page's dark ground (or trim the chart's
    foot) to height, and save as JPEG — atomically, so a failure
    never leaves a half-written og-bitcoin.jpg."""
    import io

    from PIL import Image

    img = Image.open(io.BytesIO(png_bytes)).convert("RGB")
    if img.width != 1200:
        img = img.resize(
            (1200, max(1, round(img.height * 1200 / img.width))),
            Image.LANCZOS)
    if img.height > 630:
        img = img.crop((0, 0, 1200, 630))
    elif img.height < 630:
        framed = Image.new("RGB", (1200, 630), (7, 9, 14))
        framed.paste(img, (0, (630 - img.height) // 2))
        img = framed
    tmp = out_path + ".tmp"
    img.save(tmp, "JPEG", quality=90)
    os.replace(tmp, out_path)


def _ensure_playwright():
    """The capture drives headless Chrome through Playwright,
    but the workflow's install step does not provide the package
    (it installs requests + pillow only) and the workflow file
    cannot be edited from here — so the script carries its own
    dependency: import Playwright if it is present, pip-install
    it if it is not. Any failure raises; capture_snapshot()
    turns that into the safe path (previous picture kept, the
    run still succeeds)."""
    try:
        from playwright.sync_api import sync_playwright  # noqa: F401
        return
    except ImportError:
        pass
    import importlib
    import subprocess

    print("update_btc_state: playwright is not installed; "
          "installing it with pip", file=sys.stderr)
    subprocess.run(
        [sys.executable, "-m", "pip", "install", "playwright"],
        check=True, capture_output=True)
    importlib.invalidate_caches()
    from playwright.sync_api import sync_playwright  # noqa: F401


def capture_snapshot(state, inputs, out_path=OG_PATH, view=None,
                     site_dir=HERE):
    """The true capture described in the section note above.
    Returns True when og-bitcoin.jpg was replaced by the page's
    own chart section; returns False — never raises — on any
    failure, leaving any previous file exactly as it was."""
    view = (view or CAPTURE_VIEW).strip().lower()
    cfg = _CAPTURE_VIEWS.get(view)
    if cfg is None:
        print("update_btc_state: WARNING: unknown capture view %r"
              % view, file=sys.stderr)
        return False
    try:
        _ensure_playwright()
        with open(os.path.join(site_dir, "bitcoin.html"),
                  "r", encoding="utf-8") as fh:
            page_text = fh.read()
        if view == "powerlaw":
            hooked = _inject_pl_view_hook(page_text)
            if hooked is None:
                print("update_btc_state: WARNING: power-law view "
                      "hook anchor not found; capture skipped",
                      file=sys.stderr)
                return False
            page_text = hooked
        srv = _capture_serve(site_dir, page_text.encode("utf-8"))
        try:
            png = _capture_shot(state, inputs, view, cfg,
                                srv.server_address[1])
        finally:
            srv.shutdown()
        _write_share_jpeg(png, out_path)
        return True
    except Exception as exc:
        print("update_btc_state: WARNING: chart capture failed: %s"
              % exc, file=sys.stderr)
        return False


# ------------------------------------------------------------------------- main

def main():
    now = datetime.now(timezone.utc)
    today = (now.date() - GENESIS).days

    inputs = load_page_inputs()
    peak = peak_ratio(inputs)
    if not (5 < peak < 100):
        fail("implausible PEAK_RATIO %.2f" % peak)

    spot = fetch_spot()
    if not (1000 < spot < 10_000_000):
        fail("implausible spot price %r" % spot)
    price = round(spot)  # the page rounds the spot before publishing

    closes = fetch_closes(today)
    diff_t = fetch_difficulty_t()
    if diff_t is None:
        diff_t = inputs["diff"][-1]  # the page's fallback: last baked
    mvrv_rows, cm_prices = fetch_mvrv_rows()

    readings = {
        "powerlaw": reading_powerlaw(today, price),
        "cost": reading_cost(today, price, inputs, peak, diff_t),
        "mayer": reading_mayer(today, price, closes),
    }
    mvrv, mvrv_day = reading_mvrv(mvrv_rows)
    readings["mvrv"] = mvrv
    if not (-5 < mvrv["z"] < 20):
        fail("implausible MVRV Z %r" % mvrv["z"])

    golden_all_four = all(r["band"] == "green" for r in readings.values())
    # The top state, the page's own test: the power law by its
    # unrounded position and production cost by its unrounded ratio
    # (the private _top flags — popped unconditionally, before the
    # and-chain can short-circuit past a pop and leak one into the
    # published file), the two threshold models by their red band —
    # their bands are set at exactly Mayer 2.4 and MVRV Z 7, so red
    # IS the page's test for them.
    pl_top = readings["powerlaw"].pop("_top")
    cost_top = readings["cost"].pop("_top")
    top_all_four = (pl_top and cost_top
                    and readings["mayer"]["band"] == "red"
                    and readings["mvrv"]["band"] == "red")
    # Johnny's combined score, from the readings' unrounded values
    # (the private raw keys, popped here so nothing private is
    # published). "golden" / "top" now carry the score's states —
    # the Rare Buy / Rare Sell trigger — and the all-four states
    # ride under "all_four", unchanged in meaning.
    parts = score_parts(readings["powerlaw"].pop("_pos"),
                        readings["cost"].pop("_ratio"),
                        readings["mayer"].pop("_ratio"),
                        readings["mvrv"].pop("_z"))
    score = score_value(parts)
    band = score_band(score)
    golden = band == "buy"
    top = band == "sell"
    record = record_facts(inputs, peak, golden_all_four, top_all_four)
    score_record = score_record_facts(inputs, peak, golden, top)
    grid_end = GRID_START + GRID_STEP * len(inputs["diff"]) - 1
    tail_diffs = fetch_tail_diffs(grid_end + 1, max(cm_prices))
    series = score_series(inputs, peak, cm_prices, mvrv_rows,
                          tail_diffs)
    # The Bitcoin Spiral's daily-close series (2026-11-21): the
    # CoinMetrics PriceUSD history already in hand (cm_prices, the
    # map behind the MVRV reading — its completeness was guarded in
    # fetch_mvrv_rows), published in full so the Spiral's baked
    # floors stop aging. Additive only: no existing key changes,
    # and golden_alert.py reads named keys, never this one.
    spiral_closes = [[str(GENESIS + timedelta(days=day)), round(p, 4)]
                     for day, p in sorted(cm_prices.items())]
    spiral_series = {
        "source": "CoinMetrics PriceUSD daily closes",
        "first": spiral_closes[0][0],
        "last": spiral_closes[-1][0],
        "closes": spiral_closes,
    }
    # The current cycle's extremes (2026-11-22): Yahoo daily OHLC,
    # the real traded highs and lows the closes above cannot see,
    # so the Spiral's top and bottom claims refresh with the same
    # bake instead of going stale. Additive only, like the series.
    cycle_extremes = fetch_cycle_extremes()
    state = {
        "golden": golden,
        "top": top,
        "as_of": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "price": price,
        "data": {"mvrv_day": str(GENESIS + timedelta(days=mvrv_day))},
        "readings": readings,
        "all_four": {"buy": golden_all_four, "sell": top_all_four},
        "score": {
            "value": round(score, 2),
            "band": band,
            "parts": {k: round(v, 2) for k, v in parts.items()},
        },
        "record": record,
        "score_record": score_record,
        "score_series": series,
        "spiral_series": spiral_series,
        "cycle_extremes": cycle_extremes,
    }
    tmp = OUT_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(state, fh, indent=1, sort_keys=True)
        fh.write("\n")
    os.replace(tmp, OUT_PATH)
    print("update_btc_state: golden=%s top=%s score=%s band=%s "
          "readings=%s record=%s score_record=%s series=%d days "
          "(%s to %s, last %.2f)"
          % (golden, top, round(score, 2), band,
             json.dumps(readings, sort_keys=True),
             json.dumps(record, sort_keys=True),
             json.dumps(score_record, sort_keys=True),
             len(series), series[0][0], series[-1][0], series[-1][1]))

    # The share picture rides the same run, from the same state —
    # best-effort: a picture failure never blocks the state above.
    # First choice is the TRUE CAPTURE of the page's own chart
    # section (capture_snapshot, below); any capture failure keeps
    # the previous og-bitcoin.jpg, and render_snapshot() — the
    # drawn imitation — runs only when no file exists yet.
    try:
        if capture_snapshot(state, inputs):
            print("update_btc_state: og-bitcoin.jpg captured from "
                  "the page (view: %s)" % CAPTURE_VIEW)
        elif not os.path.exists(OG_PATH):
            render_snapshot(state, inputs)
            print("update_btc_state: og-bitcoin.jpg rendered "
                  "(capture unavailable; first file)")
        else:
            print("update_btc_state: WARNING: chart capture "
                  "unavailable; previous og-bitcoin.jpg kept",
                  file=sys.stderr)
    except Exception as exc:
        print("update_btc_state: WARNING: snapshot step failed: %s"
              % exc, file=sys.stderr)


if __name__ == "__main__":
    main()
