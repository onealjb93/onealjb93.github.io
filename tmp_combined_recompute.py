#!/usr/bin/env python3
"""One-time surgical recompute of finance-chart-daily.json buy arrays.

Temporary script for the tmp-combined-dots workflow (2026-11-22).
Recomputes ONLY the buy arrays of the checked-out
finance-chart-daily.json with the repo's combined indicator code
(fetch_chart_data.compute_indicator_signals, commit d7353663) over
the file's own bars / P/E arrays / VIX series. No external data is
fetched. Hard asserts pin the input and the output to the locally
verified snapshots (input sha256 502b4f6c..., output sha256
679d9eb3...) — any drift fails the run before anything is committed.
Sells are asserted identical to the input on every series.
"""
import hashlib
import importlib.util
import json

PATH = 'finance-chart-daily.json'
EXPECT_IN = ('502b4f6cb6033a57be9ea7ddf2c431e8aee925e2ff137d0233336'
             'ee46dca74e0')
EXPECT_OUT = ('679d9eb3be9db8afadcae3aa71c2274a83ee02b8d8a4928108a'
              '3afc19e924a3b')

raw = open(PATH, 'rb').read()
in_hash = hashlib.sha256(raw).hexdigest()
print(f"input: {len(raw)} bytes sha256 {in_hash}")
assert in_hash == EXPECT_IN, f"input drifted: {in_hash}"

D = json.loads(raw)
S = D['series']
UNIVERSE = [k for k in S.keys() if k != 'VIX']
assert len(UNIVERSE) == 113, len(UNIVERSE)

vix_bars = S['VIX']['bars']
vix_dates = [b[0] for b in vix_bars]
vix_closes = [float(b[4]) for b in vix_bars]

spec = importlib.util.spec_from_file_location('fetch_chart_data',
                                              'fetch_chart_data.py')
fcd = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fcd)

new_buy, new_sell = {}, {}
for k in UNIVERSE:
    e = S[k]
    sb, ss = fcd.compute_indicator_signals(k, e['bars'], e.get('pe'),
                                           vix_dates, vix_closes)
    new_buy[k], new_sell[k] = sb, ss

sell_diff = [k for k in UNIVERSE if new_sell[k] != (S[k].get('sell') or [])]
print(f"sells identical to input on all 113 series: {not sell_diff}")
assert not sell_diff, sell_diff[:5]

assert len(new_buy['NVDA']) == 24, len(new_buy['NVDA'])
for k in ['GOOGL', 'IREN', 'AAOI', 'NVDA', 'MU', 'MSTR']:
    assert '2026-11-20' in new_buy[k], k
assert new_buy['BTC'][-1] == '2026-11-21', new_buy['BTC'][-3:]
tot_old = sum(len(S[k].get('buy') or []) for k in UNIVERSE)
tot_new = sum(len(new_buy[k]) for k in UNIVERSE)
print(f"universe buy days: {tot_old} -> {tot_new}")
assert (tot_old, tot_new) == (222, 1147), (tot_old, tot_new)
print("landmarks OK: NVDA buys = 24; GOOGL/IREN/AAOI/NVDA/MU/MSTR "
      "carry a 2026-11-20 buy; BTC latest buy = 2026-11-21")

for k in UNIVERSE:
    S[k]['buy'] = new_buy[k]
out = json.dumps(D, separators=(',', ':')).encode()
out_hash = hashlib.sha256(out).hexdigest()
print(f"output: {len(out)} bytes sha256 {out_hash}")
assert out_hash == EXPECT_OUT, f"output drifted: {out_hash}"

with open(PATH, 'wb') as fh:
    fh.write(out)
print("OK — finance-chart-daily.json rewritten with combined buy arrays")
