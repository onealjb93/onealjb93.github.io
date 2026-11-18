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
                  "mvrv":     {"z": ..., "band": ..., "pct": ...}}}

Each reading's "pct" is the percent note the page's indicator prints
beside the model's name (its fmtDist input): how far the price sits
from that model's own bottom line, as a signed percent — negative is
under the line, positive is above it. The quantities are the page's
own, per model: power law, price vs the corridor floor (fair x LO);
production cost, price vs today's cost; Mayer, the ratio minus one;
MVRV, market cap vs realized cap (the CoinMetrics ratio minus one).

"golden" is true exactly when all four models read green at once —
the page's own rule (power-law position <= 5, cost position <= 5,
Mayer <= 1.0, MVRV Z <= 0). Every page's header fetches this file and
shows a gold star only while it says golden and is fresh.

"top" is the mirror state: true exactly when all four models read
stretched at once — the page's own rule (power-law position >= 95,
production cost by its ratio: price at least 10x the cost of
production, Mayer >= 2.4, MVRV Z >= 7). The cost leg is a threshold
on the ratio, like Mayer's and MVRV's own thresholds, because the
cost position's scale is anchored to the single December 2017 peak
ratio (22.21): the top 5% of that scale needs a ratio over 21 and
has never been reached on a weekly sample. It drives nothing in
the header (the stars stay buy-only); it is published so the nightly
state carries the sell-side reading too, in the same checkable form.

The state also carries a "record" object — the rarity facts the
alert emails state: {"weeks", "golden_weeks", "top_weeks",
"last_golden_end", "last_top_end"}, counted over the page's baked
weekly series (the Mayer block's BAKED sample days are the grid,
Feb 2016 on; power law and production cost are carried from their
4-day grid, MVRV is last-value-carried-forward from its baked rows —
the rarity measurement's own grid and rules, so the published
counts are the measured ones: 564 weeks, golden in 5, top in 2).
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
    """CoinMetrics community API: daily market cap + MVRV ratio from
    2010 onward, the page's own feed and request."""
    j = get_json(
        "https://community-api.coinmetrics.io/v4/timeseries/asset-metrics",
        params={"assets": "btc",
                "metrics": "CapMrktCurUSD,CapMVRVCur",
                "frequency": "1d",
                "page_size": 10000,
                "start_time": "2010-01-01T00:00:00.000Z",
                "sort": "time"})
    rows = []
    for row in j.get("data") or []:
        try:
            y, m, d = str(row["time"])[:10].split("-")
            day = (date(int(y), int(m), int(d)) - GENESIS).days
            mv = float(row["CapMrktCurUSD"])
            ratio = float(row["CapMVRVCur"])
        except (KeyError, ValueError):
            continue
        if mv > 0 and ratio > 0:
            rows.append((day, mv, ratio))
    rows.sort()
    # The page's own guard: anything short of the full, from-the-start
    # history is not this gauge — the baked figures stand there, and
    # here the previous state file stands.
    if len(rows) < 4000 or rows[0][0] > 600:
        fail("CoinMetrics history incomplete (%d rows)" % len(rows))
    return rows


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
            "pct": round(pct, 4), "_top": pos >= 95}


def reading_cost(today, price, inputs, peak, diff_t):
    c = cost_for(today, diff_t, inputs["fees"][-1], inputs["eff"], inputs["sub"])
    pos = (price / c - 1) / (peak - 1) * 100
    # the page's zone dist is its readout devPct: (SPOT.price / c - 1) * 100
    pct = (price / c - 1) * 100
    # "_top" is private, as in reading_powerlaw: the top-state test
    # on the UNROUNDED ratio (price / cost of production) — a
    # threshold, not the position (see COST_TOP_RATIO).
    return {"pos": round(pos, 2), "band": band_of_pos(pos),
            "pct": round(pct, 4), "_top": price / c >= COST_TOP_RATIO}


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
            "pct": round((ratio - 1) * 100, 4)}


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
    band = "green" if z <= 0 else ("red" if z >= 7 else "yellow")
    # the page's zone dist: (last[2] / last[3] - 1) * 100, market cap
    # over realized cap — which is the CoinMetrics ratio itself, minus 1
    return {"z": round(z, 4), "band": band,
            "pct": round((ratio - 1) * 100, 4)}, day


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
        z = mvrv_z(day)
        golden_flags.append((day, pos_pl <= 5 and pos_cost <= 5
                             and mult <= 1.0
                             and z is not None and z <= 0))
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
        "callout": ("Golden buy zone — all four models in their "
                    "buy zones at once." if state.get("golden")
                    else "Top zone — all four models stretched at "
                         "once." if state.get("top") else None),
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
    mvrv_rows = fetch_mvrv_rows()

    readings = {
        "powerlaw": reading_powerlaw(today, price),
        "cost": reading_cost(today, price, inputs, peak, diff_t),
        "mayer": reading_mayer(today, price, closes),
    }
    mvrv, mvrv_day = reading_mvrv(mvrv_rows)
    readings["mvrv"] = mvrv
    if not (-5 < mvrv["z"] < 20):
        fail("implausible MVRV Z %r" % mvrv["z"])

    golden = all(r["band"] == "green" for r in readings.values())
    # The top state, the page's own test: the power law by its
    # unrounded position and production cost by its unrounded ratio
    # (the private _top flags — popped unconditionally, before the
    # and-chain can short-circuit past a pop and leak one into the
    # published file), the two threshold models by their red band —
    # their bands are set at exactly Mayer 2.4 and MVRV Z 7, so red
    # IS the page's test for them.
    pl_top = readings["powerlaw"].pop("_top")
    cost_top = readings["cost"].pop("_top")
    top = (pl_top and cost_top
           and readings["mayer"]["band"] == "red"
           and readings["mvrv"]["band"] == "red")
    record = record_facts(inputs, peak, golden, top)
    state = {
        "golden": golden,
        "top": top,
        "as_of": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "price": price,
        "data": {"mvrv_day": str(GENESIS + timedelta(days=mvrv_day))},
        "readings": readings,
        "record": record,
    }
    tmp = OUT_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(state, fh, indent=1, sort_keys=True)
        fh.write("\n")
    os.replace(tmp, OUT_PATH)
    print("update_btc_state: golden=%s top=%s readings=%s record=%s"
          % (golden, top, json.dumps(readings, sort_keys=True),
             json.dumps(record, sort_keys=True)))

    # The share snapshot rides the same run, from the same state —
    # best-effort: a drawing failure never blocks the state above.
    try:
        render_snapshot(state, inputs)
        print("update_btc_state: og-bitcoin.jpg rendered")
    except Exception as exc:
        print("update_btc_state: WARNING: snapshot render failed: %s"
              % exc, file=sys.stderr)


if __name__ == "__main__":
    main()
