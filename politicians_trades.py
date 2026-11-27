"""Build politicians-trades.json for the Politicians' Trades section
of finance.html — every buy and sell disclosed by a member of the
United States Congress under the STOCK Act, newest filings first.

Sources (all free, all public records):
- ZipLime/congress-trading (Hugging Face, rebuilt on a schedule from
  the primary documents): the House and Senate periodic transaction
  reports (PTRs), parsed transaction by transaction, each row linked
  to its official document — House Clerk PDFs for the House,
  efdsearch.senate.gov for the Senate. This is the primary feed for
  both chambers. (The older Senate Stock Watcher mirror stopped
  updating in December 2020 and its S3 bucket no longer answers, so
  it cannot be the source of a "latest trades" section; the House
  Stock Watcher mirror below still can, and is kept as the House
  cross-check and fallback.)
- House Stock Watcher (TattooedHead mirror of the official House
  Clerk disclosures): cross-check on House freshness, and the
  fallback House feed if the primary ever falls behind it.
- unitedstates/congress-legislators: committee assignments for
  current members (context that makes a trade readable), and party /
  state for fallback rows.
- finance-chart-daily.json (this repo, the page's own price file):
  the ONLY prices used for performance figures. A ticker the page
  does not carry gets trade data only — never an outside price,
  never an invented number.

Honesty rules:
- Amounts are the statutory disclosure RANGES, carried as the range's
  own low and high ends. The midpoint of a range is used ONLY inside
  labelled estimates (leaderboard volume, performance weighting,
  the analytics strip) and is never shown as a trade's amount.
- Performance for a disclosed buy is the underlying stock's return
  from the trade date to the latest close in the page's price file,
  weighted by range midpoint across the member's covered buys. Buys
  the price file does not cover are counted and reported as
  uncovered, never silently dropped from the methodology.
- Completeness guard: if either chamber's primary feed is missing,
  unparseable, or its newest filing is more than 21 days old, the
  run FAILS and the previous politicians-trades.json is left
  untouched — stale trades are never published dressed as fresh.
  The same if the combined trailing-12-month row count falls below
  3,000 (a truncation tripwire; the real count is ~6,700).
- Superseded filings (amendments replace originals) are excluded;
  exchanges and non-stock assets are excluded and counted in the log.

Run locally with POL_SRC_DIR set to a directory holding
house_ziplime.parquet, senate_ziplime.parquet, house_gh.json,
committee-membership-current.json, committees-current.json and
board_prices.json; otherwise everything is downloaded and the price
file is read from ./finance-chart-daily.json (the repo checkout).
"""

import json
import os
import sys
from bisect import bisect_left
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone

HF_HOUSE = "https://huggingface.co/datasets/ZipLime/congress-trading/resolve/main/data/trades/trades-house.parquet"
HF_SENATE = "https://huggingface.co/datasets/ZipLime/congress-trading/resolve/main/data/trades/trades-senate.parquet"
TH_HOUSE = "https://raw.githubusercontent.com/TattooedHead/house-stock-watcher-data/main/data/all_transactions.json"
LEGIS_MEMBERSHIP = "https://unitedstates.github.io/congress-legislators/committee-membership-current.json"
LEGIS_COMMITTEES = "https://unitedstates.github.io/congress-legislators/committees-current.json"
LEGIS_CURRENT = "https://unitedstates.github.io/congress-legislators/legislators-current.json"
LEGIS_HISTORICAL = "https://unitedstates.github.io/congress-legislators/legislators-historical.json"

EPOCH = date(1970, 1, 1)
STALE_DAYS = 21
MIN_ROWS = 3000
OUT = os.environ.get("POL_OUT", "politicians-trades.json")


def log(msg):
    print("[politicians] " + msg, flush=True)


def fail(msg):
    print("[politicians] FAIL: " + msg, flush=True)
    sys.exit(1)


def fetch_bytes(url, tries=3):
    import requests
    last = None
    for i in range(tries):
        try:
            r = requests.get(url, timeout=120, headers={"User-Agent": "Mozilla/5.0 (politicians-trades builder)"})
            r.raise_for_status()
            return r.content
        except Exception as e:  # noqa: BLE001
            last = e
            log("fetch retry %d for %s (%s)" % (i + 1, url.rsplit("/", 1)[-1], e))
    raise last


def epoch_day(iso):
    return (date.fromisoformat(iso) - EPOCH).days


def fmt_range(lo, hi):
    def money(n):
        return "$" + format(int(n), ",")
    if hi is None:
        return money(lo) + " +"
    return money(lo) + " \u2013 " + money(hi)


def midpoint(lo, hi):
    if hi is None:
        return float(lo)
    return (float(lo) + float(hi)) / 2.0


# ---------------------------------------------------------------- feeds

def load_ziplime(path_or_bytes, chamber):
    import io
    import pyarrow.parquet as pq
    if isinstance(path_or_bytes, (bytes, bytearray)):
        table = pq.read_table(io.BytesIO(bytes(path_or_bytes)))
    else:
        table = pq.read_table(path_or_bytes)
    df = table.to_pandas()
    rows = []
    stats = Counter()
    for rec in df.to_dict("records"):
        stats["seen"] += 1
        if str(rec.get("source_form")) != "ptr":
            stats["not_ptr"] += 1
            continue
        if rec.get("superseded_by") is not None and str(rec.get("superseded_by")) not in ("", "None", "nan"):
            stats["superseded"] += 1
            continue
        ttype = str(rec.get("transaction_type") or "")
        if ttype == "purchase":
            side, partial = 0, 0
        elif ttype == "sale_full":
            side, partial = 1, 0
        elif ttype == "sale_partial":
            side, partial = 1, 1
        else:
            stats["not_buy_sell"] += 1
            continue
        if str(rec.get("asset_category") or "") not in ("stock", "option"):
            stats["not_stock"] += 1
            continue
        ticker = str(rec.get("ticker") or "").strip().upper()
        if not ticker or ticker in ("--", "N/A", "NONE"):
            stats["no_ticker"] += 1
            continue
        txn = rec.get("transaction_date")
        filed = rec.get("filing_date")
        txn_s = "" if txn is None else str(txn)[:10]
        filed_s = "" if filed is None else str(filed)[:10]
        try:
            txn_d = date.fromisoformat(txn_s)
            filed_d = date.fromisoformat(filed_s)
        except ValueError:
            stats["bad_date"] += 1
            continue
        if filed_d < txn_d:
            stats["negative_lag"] += 1
            continue
        lo = rec.get("min_amount_usd")
        hi = rec.get("max_amount_usd")
        if lo is None or str(lo) == "nan":
            stats["no_amount"] += 1
            continue
        lo = int(float(lo))
        hi = None if hi is None or str(hi) == "nan" else int(float(hi))
        owner = str(rec.get("owner") or "").strip().lower()
        owner_code = {"self": 0, "spouse": 1, "joint": 2, "child": 3}.get(owner, 4)
        opt = ""
        if rec.get("is_option"):
            ot = str(rec.get("option_type") or "").strip().lower()
            opt = "C" if ot.startswith("call") else ("P" if ot.startswith("put") else "")
        party_full = str(rec.get("party") or "")
        party = {"Republican": "R", "Democrat": "D", "Independent": "I"}.get(party_full, "")
        rows.append({
            "name": str(rec.get("member_name") or "").strip(),
            "bioguide": str(rec.get("bioguide_id") or ""),
            "party": party,
            "state": str(rec.get("state") or ""),
            "chamber": chamber,
            "ticker": ticker,
            "side": side,
            "partial": partial,
            "opt": opt,
            "lo": lo,
            "hi": hi,
            "txn": txn_d,
            "filed": filed_d,
            "owner": owner_code,
            "doc": str(rec.get("report_url") or ""),
        })
    log("%s ZipLime: %s" % (chamber, dict(stats)))
    return rows


def load_house_fallback(raw_json, legis_by_name):
    """House rows from the House Stock Watcher mirror (official House
    Clerk PTRs). Party/state come from the legislators datasets,
    matched on name + district state."""
    data = json.loads(raw_json)
    rows = []
    stats = Counter()
    for rec in data:
        stats["seen"] += 1
        ttype = str(rec.get("type") or "")
        if ttype == "Purchase":
            side, partial = 0, 0
        elif ttype.startswith("Sale"):
            side, partial = 1, 0
        else:
            stats["not_buy_sell"] += 1
            continue
        if str(rec.get("asset_type") or "") != "Stock":
            stats["not_stock"] += 1
            continue
        ticker = str(rec.get("ticker") or "").strip().upper()
        if not ticker or ticker in ("--", "N/A"):
            stats["no_ticker"] += 1
            continue
        try:
            txn_d = datetime.strptime(rec["transaction_date"], "%m/%d/%Y").date()
            filed_d = datetime.strptime(rec["disclosure_date"], "%m/%d/%Y").date()
        except Exception:  # noqa: BLE001
            stats["bad_date"] += 1
            continue
        amt = str(rec.get("amount") or "")
        lo = hi = None
        if " - " in amt:
            a, b = amt.replace("$", "").replace(",", "").split(" - ")
            lo, hi = int(a), int(b)
        elif amt.endswith("+"):
            lo = int(amt.replace("$", "").replace(",", "").replace("+", "").strip())
        if lo is None:
            stats["no_amount"] += 1
            continue
        name = str(rec.get("representative") or "").strip()
        district = str(rec.get("district") or "")
        leg = legis_by_name.get(name.lower())
        party = leg["party"] if leg else ""
        state = district[:2] if len(district) >= 2 else (leg["state"] if leg else "")
        owner = str(rec.get("owner") or "").strip().lower()
        owner_code = {"self": 0, "spouse": 1, "joint": 2, "child": 3}.get(owner, 4)
        rows.append({
            "name": name,
            "bioguide": leg["bioguide"] if leg else "",
            "party": party,
            "state": state,
            "chamber": "House",
            "ticker": ticker,
            "side": side,
            "partial": partial,
            "opt": "",
            "lo": lo,
            "hi": hi,
            "txn": txn_d,
            "filed": filed_d,
            "owner": owner_code,
            "doc": str(rec.get("source_url") or ""),
        })
    log("House fallback (Stock Watcher): %s" % dict(stats))
    return rows


# ---------------------------------------------------------------- main

def main():
    src = os.environ.get("POL_SRC_DIR")
    if src:
        house_rows = load_ziplime(os.path.join(src, "house_ziplime.parquet"), "House")
        senate_rows = load_ziplime(os.path.join(src, "senate_ziplime.parquet"), "Senate")
        th_raw = open(os.path.join(src, "house_gh.json"), "rb").read()
        membership = json.load(open(os.path.join(src, "committee-membership-current.json")))
        committees = json.load(open(os.path.join(src, "committees-current.json")))
        prices = json.load(open(os.path.join(src, "board_prices.json")))
        legis_current = json.load(open(os.path.join(src, "legislators-current.json"))) if os.path.exists(os.path.join(src, "legislators-current.json")) else []
        legis_historical = []
    else:
        house_rows = load_ziplime(fetch_bytes(HF_HOUSE), "House")
        senate_rows = load_ziplime(fetch_bytes(HF_SENATE), "Senate")
        th_raw = fetch_bytes(TH_HOUSE)
        membership = json.loads(fetch_bytes(LEGIS_MEMBERSHIP))
        committees = json.loads(fetch_bytes(LEGIS_COMMITTEES))
        prices = json.load(open("finance-chart-daily.json"))
        legis_current = json.loads(fetch_bytes(LEGIS_CURRENT))
        legis_historical = json.loads(fetch_bytes(LEGIS_HISTORICAL))

    today = datetime.now(timezone.utc).replace(tzinfo=None).date()

    # --- completeness guard: both chambers fresh at the source ------
    for rows, chamber in ((house_rows, "House"), (senate_rows, "Senate")):
        if not rows:
            fail("%s primary feed returned no usable rows" % chamber)
        newest = max(r["filed"] for r in rows)
        if (today - newest).days > STALE_DAYS:
            fail("%s primary feed is stale: newest filing %s is %d days old" % (chamber, newest, (today - newest).days))
        log("%s primary: %d rows, newest filing %s" % (chamber, len(rows), newest))

    # --- House cross-check / fallback --------------------------------
    th_max = None
    try:
        th_data = json.loads(th_raw)
        th_dates = []
        for rec in th_data:
            try:
                th_dates.append(datetime.strptime(rec["disclosure_date"], "%m/%d/%Y").date())
            except Exception:  # noqa: BLE001
                pass
        th_max = max(th_dates) if th_dates else None
    except Exception as e:  # noqa: BLE001
        log("House cross-check unavailable (%s) — proceeding on the primary feed" % e)
    house_newest = max(r["filed"] for r in house_rows)
    if th_max and (th_max - house_newest).days > 14:
        log("Primary House feed lags the Stock Watcher mirror by %d days — falling back" % (th_max - house_newest).days)
        legis_by_name = {}
        for leg in list(legis_current) + list(legis_historical):
            nm = leg.get("name", {})
            official = (nm.get("official_full") or "").strip()
            if official:
                terms = leg.get("terms") or []
                state = terms[-1].get("state", "") if terms else ""
                party_full = terms[-1].get("party", "") if terms else ""
                legis_by_name[official.lower()] = {
                    "bioguide": leg.get("id", {}).get("bioguide", ""),
                    "party": {"Republican": "R", "Democrat": "D", "Independent": "I"}.get(party_full, ""),
                    "state": state,
                }
        house_rows = load_house_fallback(th_raw, legis_by_name)
        if not house_rows:
            fail("House fallback returned no usable rows")
        house_newest = max(r["filed"] for r in house_rows)

    rows_all = house_rows + senate_rows
    as_of = max(r["filed"] for r in rows_all)
    window_start = as_of - timedelta(days=365)
    rows = [r for r in rows_all if r["filed"] >= window_start]
    log("window: filed %s .. %s — %d rows" % (window_start, as_of, len(rows)))
    if len(rows) < MIN_ROWS:
        fail("only %d rows in the trailing-12-month window (tripwire %d) — refusing to publish a truncated file" % (len(rows), MIN_ROWS))

    # --- dedupe -------------------------------------------------------
    seen = set()
    deduped = []
    for r in rows:
        key = (r["name"], r["ticker"], r["side"], r["lo"], r["hi"], r["txn"].isoformat(), r["filed"].isoformat(), r["owner"])
        if key in seen:
            continue
        seen.add(key)
        deduped.append(r)
    log("dedupe: %d -> %d rows" % (len(rows), len(deduped)))
    rows = deduped

    # --- committees (current members) ---------------------------------
    committee_names = {c["thomas_id"]: c["name"] for c in committees if c.get("thomas_id")}
    for sub in committees:
        for s in sub.get("subcommittees", []) or []:
            committee_names[sub["thomas_id"] + s["thomas_id"]] = sub["name"] + " — " + s["name"]
    member_committees = {}
    for cid, people in membership.items():
        cname = committee_names.get(cid)
        if not cname:
            continue
        for p in people:
            bg = p.get("bioguide")
            if not bg:
                continue
            label = cname
            title = (p.get("title") or "").strip()
            if title in ("Chair", "Chairman", "Ranking Member"):
                label = cname + " (" + ("Chair" if title != "Ranking Member" else "Ranking Member") + ")"
            member_committees.setdefault(bg, []).append(label)
    for bg in member_committees:
        member_committees[bg] = sorted(set(member_committees[bg]))[:5]

    # --- members table --------------------------------------------------
    members = []
    member_idx = {}
    for r in rows:
        key = (r["name"], r["chamber"])
        if key not in member_idx:
            member_idx[key] = len(members)
            members.append([
                r["name"], r["party"], r["state"], r["chamber"], r["bioguide"],
                member_committees.get(r["bioguide"], []),
            ])
        r["m"] = member_idx[key]

    # --- prices ---------------------------------------------------------
    series = prices.get("series", {})
    board = sorted(series.keys())
    board_set = set(board)
    price_through = prices.get("through", "")
    closes = {}
    for t in board:
        bars = series[t].get("bars") or []
        if bars:
            closes[t] = ([b[0] for b in bars], [float(b[4]) for b in bars])

    def board_ticker(ticker):
        if ticker in board_set:
            return ticker
        alt = ticker.replace(".", "-")
        if alt in board_set:
            return alt
        alt2 = ticker.replace("-", ".")
        if alt2 in board_set:
            return alt2
        return None

    def ret_since(ticker, when):
        bt = board_ticker(ticker)
        if not bt or bt not in closes:
            return None
        dates, vals = closes[bt]
        iso = when.isoformat()
        i = bisect_left(dates, iso)
        if i >= len(dates):
            return None
        base = vals[i]
        if not base:
            return None
        return vals[-1] / base - 1.0

    def perf_of(buys):
        """Midpoint-weighted return of covered buys; returns
        (pct or None, covered count, total buys with any ticker)."""
        wsum = 0.0
        acc = 0.0
        covered = 0
        for r in buys:
            ret = ret_since(r["ticker"], r["txn"])
            if ret is None:
                continue
            w = midpoint(r["lo"], r["hi"])
            acc += w * ret
            wsum += w
            covered += 1
        if covered == 0 or wsum == 0:
            return None, 0, len(buys)
        return round(100.0 * acc / wsum, 1), covered, len(buys)

    # --- leaderboard ----------------------------------------------------
    by_member = defaultdict(list)
    for r in rows:
        by_member[r["m"]].append(r)
    lb = []
    for m, mrows in by_member.items():
        vol = sum(midpoint(r["lo"], r["hi"]) for r in mrows)
        buys = [r for r in mrows if r["side"] == 0]
        sells = [r for r in mrows if r["side"] == 1]
        perf, cov, tot = perf_of(buys)
        top = [t for t, _ in Counter(r["ticker"] for r in mrows).most_common(3)]
        lb.append({
            "m": m,
            "trades": len(mrows),
            "buys": len(buys),
            "sells": len(sells),
            "volMid": int(round(vol)),
            "buyPerf": perf,
            "buyPerfCovered": cov,
            "buyPerfOf": tot,
            "avgLag": round(sum((r["filed"] - r["txn"]).days for r in mrows) / len(mrows), 1),
            "top": top,
            "lastFiled": max(r["filed"] for r in mrows).isoformat(),
        })
    lb.sort(key=lambda e: (-e["volMid"], -e["trades"]))
    lb = lb[:12]

    # --- clusters ---------------------------------------------------------
    buys_by_ticker = defaultdict(list)
    for r in rows:
        if r["side"] == 0:
            buys_by_ticker[r["ticker"]].append(r)
    clusters = []
    for ticker, brows in buys_by_ticker.items():
        brows.sort(key=lambda r: r["txn"])
        best = None
        j = 0
        for i in range(len(brows)):
            if j < i:
                j = i
            while j < len(brows) and (brows[j]["txn"] - brows[i]["txn"]).days <= 45:
                j += 1
            window = brows[i:j]
            distinct = {r["m"] for r in window}
            if len(distinct) >= 3:
                cand = (len(distinct), len(window), window)
                if best is None or cand[:2] > best[:2]:
                    best = cand
        if best:
            # No recency filter: disclosure lag means the most recent
            # trade weeks are always incompletely filed, so a "current
            # clusters only" rule would hide real clusters and flatter
            # old ones. Every cluster prints its own trade window —
            # the dates keep it honest.
            window = best[2]
            perf, cov, tot = perf_of(window)
            clusters.append({
                "t": ticker,
                "n": best[0],
                "members": sorted({r["m"] for r in window}),
                "from": window[0]["txn"].isoformat(),
                "to": window[-1]["txn"].isoformat(),
                "trades": len(window),
                "perf": perf,
                "perfCovered": cov,
                "perfOf": tot,
            })
    clusters.sort(key=lambda c: (c["n"], c["to"], c["trades"]), reverse=True)
    clusters = clusters[:10]

    # --- synthetic portfolio curves (Phase 5) -------------------------
    # A reconstruction from the disclosed trades — never the member's
    # real account. Covered trades only (ticker in the page's price
    # file): a buy opens a lot of midpoint/close shares at the trade
    # date's close; a sell closes the oldest lots first at that day's
    # close (a sell of shares never bought inside the window is left
    # out — the position it came from is invisible). The curve is
    # 100 + 100 * (realised + open P&L) / total covered buy midpoints,
    # sampled on the last trading day of each week, beside the S&P 500
    # on the same footing.
    spx_dates, spx_vals = closes.get("SPX", ([], []))

    def close_on(bt, iso):
        dates, vals = closes[bt]
        i = bisect_left(dates, iso)
        if i >= len(dates):
            return None
        return vals[i]

    week_ends = []
    seen_weeks = set()
    for dstr in spx_dates:
        d0 = date.fromisoformat(dstr)
        if d0 < window_start or d0 > as_of:
            continue
        key = (d0.isocalendar()[0], d0.isocalendar()[1])
        if key in seen_weeks:
            week_ends[-1] = dstr
        else:
            seen_weeks.add(key)
            week_ends.append(dstr)
    spx_curve = []
    if week_ends and spx_vals:
        base_spx = close_on("SPX", week_ends[0])
        for w in week_ends:
            c = close_on("SPX", w)
            spx_curve.append(round(100.0 * c / base_spx, 1) if c and base_spx else None)

    def build_curve(trades):
        lots = defaultdict(list)  # board ticker -> [[shares, buy_price], ...]
        realised = 0.0
        total_buy_mid = 0.0
        covered_buys = 0
        events = []
        for r in trades:
            bt = board_ticker(r["ticker"])
            if not bt or bt not in closes:
                continue
            px = close_on(bt, r["txn"].isoformat())
            if px is None or px <= 0:
                continue
            events.append((r["txn"], r["side"], bt, px, midpoint(r["lo"], r["hi"])))
            if r["side"] == 0:
                total_buy_mid += midpoint(r["lo"], r["hi"])
                covered_buys += 1
        if covered_buys < 3 or total_buy_mid <= 0 or not week_ends:
            return None
        events.sort(key=lambda e: e[0])
        vals = []
        ei = 0
        for w in week_ends:
            wd = date.fromisoformat(w)
            while ei < len(events) and events[ei][0] <= wd:
                _, side, bt, px, mid = events[ei]
                ei += 1
                if side == 0:
                    lots[bt].append([mid / px, px])
                else:
                    to_sell = mid / px
                    while to_sell > 1e-12 and lots[bt]:
                        lot = lots[bt][0]
                        take = min(lot[0], to_sell)
                        realised += take * (px - lot[1])
                        lot[0] -= take
                        to_sell -= take
                        if lot[0] <= 1e-12:
                            lots[bt].pop(0)
            open_pnl = 0.0
            for bt, bt_lots in lots.items():
                if not bt_lots:
                    continue
                c = close_on(bt, w)
                if c is None:
                    continue
                for shares, buy_px in bt_lots:
                    open_pnl += shares * (c - buy_px)
            vals.append(round(100.0 + 100.0 * (realised + open_pnl) / total_buy_mid, 1))
        return vals

    curves = {}
    lb_members = {e["m"] for e in lb}
    for m in sorted(lb_members):
        cv = build_curve(by_member[m])
        if cv:
            curves[str(m)] = cv
    congress_curve = build_curve(rows)
    log("curves: %d of %d leaderboard members covered; congress curve %s" % (
        len(curves), len(lb_members), "yes" if congress_curve else "no"))

    # --- analytics --------------------------------------------------------
    month_key = as_of.isoformat()[:7]
    month_rows = [r for r in rows if r["filed"].isoformat()[:7] == month_key]
    m_buys = [r for r in month_rows if r["side"] == 0]
    m_sells = [r for r in month_rows if r["side"] == 1]
    hot_cut = as_of - timedelta(days=30)
    hot = Counter(r["ticker"] for r in rows if r["filed"] >= hot_cut)
    analytics = {
        "month": month_key,
        "volEst": int(round(sum(midpoint(r["lo"], r["hi"]) for r in month_rows))),
        "buys": len(m_buys),
        "sells": len(m_sells),
        "buyVolEst": int(round(sum(midpoint(r["lo"], r["hi"]) for r in m_buys))),
        "sellVolEst": int(round(sum(midpoint(r["lo"], r["hi"]) for r in m_sells))),
        "hot30": [[t, c] for t, c in hot.most_common(5)],
    }

    # --- rows out ----------------------------------------------------------
    rows.sort(key=lambda r: (r["filed"], r["txn"]), reverse=True)
    out_rows = [[
        r["m"], r["ticker"], r["side"], r["partial"], r["opt"], r["lo"],
        (r["hi"] if r["hi"] is not None else 0),
        epoch_day(r["txn"].isoformat()), epoch_day(r["filed"].isoformat()),
        r["owner"], r["doc"],
    ] for r in rows]

    out = {
        "counts": {"rows": len(rows), "members": len(members)},
        "asOf": as_of.isoformat(),
        "builtAt": datetime.now(timezone.utc).replace(tzinfo=None).isoformat(timespec="seconds") + "Z",
        "windowFrom": window_start.isoformat(),
        "priceThrough": price_through,
        "sources": {
            "house": "House Clerk PTRs via ZipLime/congress-trading (primary); House Stock Watcher mirror cross-check",
            "senate": "Senate eFD PTRs via ZipLime/congress-trading (primary)",
            "committees": "unitedstates/congress-legislators (current members)",
            "prices": "finance-chart-daily.json — this page's own price file",
        },
        "method": {
            "leaderboard": "Members ranked by total disclosed volume over the trailing 12 months of filings, each trade counted at the midpoint of its disclosed range (an estimate — trades themselves are always shown as ranges); ties broken by trade count.",
            "performance": "For each disclosed buy, the underlying stock's return from the trade date to the latest close in this page's price file, weighted by range midpoint. Only buys in stocks the price file covers are graded; the covered count is shown with every figure.",
            "clusters": "A ticker appears when at least 3 different members bought it within one rolling 45-day window of trade dates; each cluster shows its strongest such window from the trailing 12 months of filings, with the window's dates. Disclosure lag means the most recent weeks are always incompletely filed, so clusters are not filtered to 'recent' ones.",
            "curves": "A reconstruction from the disclosed trades, not the member's real account: each covered buy opens a position sized at its range midpoint at the trade date's close in this page's price file; sells close the oldest positions first; sales of positions opened before the window are left out, as are trades in stocks the price file does not cover. Indexed to 100 at the window's start, beside the S&P 500 over the same weeks.",
            "late": "The STOCK Act gives a member 45 days from a trade to disclose it. A filing that took longer is flagged with the number of days past the deadline — the dates themselves, stated plainly.",
        },
        "members": members,
        "rows": out_rows,
        "board": board,
        "leaderboard": lb,
        "clusters": clusters,
        "analytics": analytics,
        "curveDates": week_ends,
        "spxCurve": spx_curve,
        "curves": curves,
        "congressCurve": congress_curve,
    }
    with open(OUT, "w") as f:
        json.dump(out, f, separators=(",", ":"), ensure_ascii=False)
    log("wrote %s — %d rows, %d members, as-of %s, %.0f KB" % (
        OUT, len(out_rows), len(members), as_of, os.path.getsize(OUT) / 1024.0))


if __name__ == "__main__":
    main()
