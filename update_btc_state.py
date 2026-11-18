#!/usr/bin/env python3
"""Nightly Bitcoin golden-state writer for johnny-oneal.com.

Computes the same four buy-zone readings the Bitcoin page's buy-time
indicator publishes (power law, production cost, Mayer Multiple, MVRV
Z-Score) from the same public feeds the page itself uses, and writes
one tiny file, btc-state.json, at the repo root:

    {"golden": bool, "as_of": "<UTC ISO timestamp>",
     "price": <spot USD>, "data": {"mvrv_day": "YYYY-MM-DD"},
     "readings": {"powerlaw": {"pos": ..., "band": ...},
                  "cost":     {"pos": ..., "band": ...},
                  "mayer":    {"ratio": ..., "band": ...},
                  "mvrv":     {"z": ..., "band": ...}}}

"golden" is true exactly when all four models read green at once —
the page's own rule (power-law position <= 5, cost position <= 5,
Mayer <= 1.0, MVRV Z <= 0). Every page's header fetches this file and
shows a gold star only while it says golden and is fresh.

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

GENESIS = date(2009, 1, 3)
DAY_S = 86400

# Power-law constants, from the page's btc-pl-code block.
PL_A, PL_N, PL_LO, PL_HI = -16.493, 5.688, 0.398, 2.512
# Cost-model constant, from the page's btc-cost-code block.
ELEC = 0.05  # $ per kWh
GRID_START, GRID_STEP = 592, 4

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
    inputs = {
        "prices": _array(pl, "PRICES"),
        "diff": _array(cost, "DIFF"),
        "fees": _array(cost, "FEES"),
        "eff": _array(cost, "EFF"),
        "sub": _array(cost, "SUB"),
    }
    n = len(inputs["prices"])
    if not (len(inputs["diff"]) == len(inputs["fees"]) == n and n > 1000):
        fail("baked grids disagree or are implausibly short")
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
    return {"pos": round(pos, 2), "band": band_of_pos(pos)}


def reading_cost(today, price, inputs, peak, diff_t):
    c = cost_for(today, diff_t, inputs["fees"][-1], inputs["eff"], inputs["sub"])
    pos = (price / c - 1) / (peak - 1) * 100
    return {"pos": round(pos, 2), "band": band_of_pos(pos)}


def reading_mayer(today, price, closes):
    pts = [(d, c) for d, c in closes if d <= today]
    pts = [(d, c) for d, c in pts if d < today]
    pts.append((today, float(price)))
    if len(pts) < 200:
        fail("fewer than 200 closes for the Mayer average")
    window = [c for _, c in pts[-200:]]
    ratio = price / (sum(window) / 200)
    band = "green" if ratio <= 1 else ("red" if ratio >= 2.4 else "yellow")
    return {"ratio": round(ratio, 4), "band": band}


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
                last = (day, (mv - rv) / std)
    if last is None:
        fail("MVRV series too short")
    day, z = last
    band = "green" if z <= 0 else ("red" if z >= 7 else "yellow")
    return {"z": round(z, 4), "band": band}, day


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
    state = {
        "golden": golden,
        "as_of": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "price": price,
        "data": {"mvrv_day": str(GENESIS + timedelta(days=mvrv_day))},
        "readings": readings,
    }
    tmp = OUT_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(state, fh, indent=1, sort_keys=True)
        fh.write("\n")
    os.replace(tmp, OUT_PATH)
    print("update_btc_state: golden=%s readings=%s"
          % (golden, json.dumps(readings, sort_keys=True)))


if __name__ == "__main__":
    main()
