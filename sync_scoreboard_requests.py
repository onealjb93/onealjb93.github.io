#!/usr/bin/env python3
"""Sync the scoreboard's grading set with the owner's requests.

The scoreboard page's "Add a stock" control opens a prefilled
GitHub issue titled "Scoreboard add: <TICKER>" (or "Scoreboard
remove: <TICKER>"). This step runs in the nightly workflow BEFORE
update_finance.py: it reads the open issues, keeps only the ones
authored by the repository owner, validates each ticker against
the Nasdaq-100 list the repo already carries
(finance-chart-data.json), merges the change into
scoreboard-stocks.json, and closes the issue with a comment
saying what happened.

Safety: the author check is the security boundary — anyone can
open an issue on a public repo, so an issue counts only when its
author's login is the repo owner's. Tickers are validated against
the Nasdaq-100 list, never trusted from the title. The core 19
stocks can never be removed by request. Every failure path logs
and exits 0 without touching the issues, so a bad night retries
on the next run and this step can never break the data refresh.
Idempotent: re-running over the same issues changes nothing —
an add for a stock already in the set just closes as a no-op.
"""

import json
import os
import re
import sys

import requests

SET_FILE = "scoreboard-stocks.json"
CHART_DATA_FILE = "finance-chart-data.json"
TITLE_RE = re.compile(
    r"^Scoreboard (add|remove):\s*([A-Z][A-Z0-9.\-]{0,9})\s*$")

# The original 19 — removal requests can never touch these.
# Mirrors CORE_TICKERS in update_finance.py; keep the two in sync.
CORE_TICKERS = [
    "GOOGL", "ASST", "CIFR", "SPCX", "NBIS", "IREN", "AAOI",
    "NVDA", "AMD", "PLTR", "MU", "TSLA", "MSTR", "TSM",
    "LLY", "WM", "COST", "JPM", "WMT",
]


def log(msg):
    print(msg, flush=True)


def parse_title(title):
    """(action, ticker) for a request title, else None."""
    if not isinstance(title, str):
        return None
    m = TITLE_RE.match(title.strip())
    if not m:
        return None
    return m.group(1), m.group(2)


def load_set(path=SET_FILE):
    """The grading set as (doc, tickers); (None, None) if the file
    is missing or malformed — the caller then touches nothing."""
    try:
        with open(path) as fh:
            doc = json.load(fh)
    except (OSError, ValueError):
        return None, None
    raw = doc.get("tickers") if isinstance(doc, dict) else doc
    if not isinstance(raw, list) or not raw:
        return None, None
    tickers = []
    for t in raw:
        if isinstance(t, str) and t not in tickers:
            tickers.append(t)
    return (doc if isinstance(doc, dict) else {}), tickers


def save_set(doc, tickers, path=SET_FILE):
    out = dict(doc or {})
    out["tickers"] = tickers
    tmp = path + ".tmp"
    with open(tmp, "w") as fh:
        json.dump(out, fh, indent=2)
        fh.write("\n")
    os.replace(tmp, path)


def load_ndx(path=CHART_DATA_FILE):
    """The Nasdaq-100 tickers the repo carries, or None."""
    try:
        with open(path) as fh:
            doc = json.load(fh)
    except (OSError, ValueError):
        return None
    raw = doc.get("nasdaq100") if isinstance(doc, dict) else None
    if not isinstance(raw, list) or not raw:
        return None
    return set(t for t in raw if isinstance(t, str))


def decide(tickers, ndx, action, ticker):
    """One request against the current set: (new_tickers, outcome,
    comment). new_tickers is None when the set doesn't change.
    Every outcome closes the issue — each is a definitive answer,
    not a failure."""
    if action == "add":
        if ticker not in ndx:
            return None, "not-ndx", (
                "%s isn't in the Nasdaq-100 list this site carries, "
                "so it can't be added to the scoreboard." % ticker)
        if ticker in tickers:
            return None, "already", (
                "%s is already on the scoreboard — no change."
                % ticker)
        return tickers + [ticker], "added", (
            "Added %s to the scoreboard's grading set. Tonight's "
            "data run grades it — until the first grades land, the "
            "scoreboard shows it as added, with no score invented "
            "for it." % ticker)
    # remove
    if ticker in CORE_TICKERS:
        return None, "core-protected", (
            "%s is one of the original 19 core stocks, which "
            "can't be removed by request." % ticker)
    if ticker not in tickers:
        return None, "not-on", (
            "%s wasn't on the scoreboard — no change." % ticker)
    return [t for t in tickers if t != ticker], "removed", (
        "Removed %s from the scoreboard's grading set. Tonight's "
        "data run stops grading it." % ticker)


def main(session=None):
    token = os.environ.get("GITHUB_TOKEN")
    repo = os.environ.get("GITHUB_REPOSITORY")
    if not token or not repo or "/" not in repo:
        log("scoreboard sync: GITHUB_TOKEN / GITHUB_REPOSITORY "
            "not set; nothing done")
        return 0
    owner = repo.split("/", 1)[0]
    if session is None:
        session = requests.Session()
    headers = {
        "Authorization": "Bearer %s" % token,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "onealjb93.github.io scoreboard sync",
    }
    api = "https://api.github.com/repos/%s" % repo
    try:
        # Every page, not just the first (2026-11-23): the filter
        # is ALL open owner issues, so a backlog beyond 100 would
        # push scoreboard requests off the only page ever read —
        # unseen, uncommented, and never retried in any way that
        # matters.
        issues = []
        page = 1
        while True:
            resp = session.get(
                api + "/issues",
                params={"state": "open", "creator": owner,
                        "per_page": "100", "page": str(page)},
                headers=headers, timeout=30)
            resp.raise_for_status()
            batch = resp.json()
            if not isinstance(batch, list):
                break
            issues.extend(batch)
            if len(batch) < 100:
                break
            page += 1
    except Exception as exc:
        log("scoreboard sync: issue list failed (%s); nothing done"
            % exc)
        return 0
    doc, tickers = load_set()
    ndx = load_ndx()
    if tickers is None or ndx is None:
        log("scoreboard sync: %s or %s unreadable; nothing done"
            % (SET_FILE, CHART_DATA_FILE))
        return 0
    requests_found = []
    for issue in issues if isinstance(issues, list) else []:
        if not isinstance(issue, dict) or "pull_request" in issue:
            continue
        user = (issue.get("user") or {}).get("login")
        if user != owner:
            continue
        parsed = parse_title(issue.get("title"))
        if parsed is None:
            continue
        requests_found.append((issue.get("number", 0), issue, parsed))
    requests_found.sort(key=lambda x: x[0])
    for _num, issue, (action, ticker) in requests_found:
        new_tickers, outcome, comment = decide(
            tickers, ndx, action, ticker)
        if new_tickers is not None:
            try:
                save_set(doc, new_tickers)
            except OSError as exc:
                log("scoreboard sync: could not write %s (%s); "
                    "issue #%s left open" % (SET_FILE, exc,
                                             issue.get("number")))
                continue
            tickers = new_tickers
        try:
            # Check the HTTP status, not just the transport
            # (2026-11-23): requests returns 403/404/422 as
            # ordinary responses, and the old code logged success
            # either way — a permanently permissionless token
            # would "close" issues forever without closing any.
            resp = session.post(api + "/issues/%s/comments"
                                % issue["number"],
                                headers=headers,
                                json={"body": comment}, timeout=30)
            resp.raise_for_status()
            resp = session.patch(api + "/issues/%s" % issue["number"],
                                 headers=headers,
                                 json={"state": "closed"}, timeout=30)
            resp.raise_for_status()
        except Exception as exc:
            log("scoreboard sync: issue #%s decided (%s) but the "
                "comment/close failed (%s)"
                % (issue.get("number"), outcome, exc))
            continue
        log("scoreboard sync: #%s %s %s -> %s"
            % (issue.get("number"), action, ticker, outcome))
    if not requests_found:
        log("scoreboard sync: no open requests")
    return 0


if __name__ == "__main__":
    sys.exit(main())
