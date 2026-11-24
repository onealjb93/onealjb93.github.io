#!/usr/bin/env python3
"""Nightly share-stub refresher for johnny-oneal.com.

Johnny's standing rule (2026-11-18): "If I ever change a photo, the links
must automatically pull the new photo, not the old one." The per-item share
doorways under /s/ (built once by share-stubs/work/generate.py) freeze the
photo references that were current on build day. This script re-derives
every doorway's og:title / og:description / og:image — and the three photo
page-cards — from the CURRENT sources of truth in the repo checkout:

    recipes.html        recipe titles + the photos embedded as data URIs
    sustainability.html example names, hooks and photos
    media.html          book titles, authors, ratings
    random.html         the POOLS data (photo entries + stage URLs)
    quotes-data.js      quote texts and authors
    engineering-data.js engineering entry names, overviews and photos
    websites-data.js    website names, overviews and preview images
    scifi-data.js       sci-fi entry names, overviews and photos
    finance-chart-data.json the 19 stocks' names and weekly bars

...and rewrites ONLY what changed:

    * a stub whose derived meta differs from the file on disk;
    * s/img/recipe-<id>.jpg when the recipe's embedded photo bytes differ
      (compared by SHA-256; the photo is stored byte-for-byte, never
      re-encoded — exactly as generate.py extracted it);
    * og-recipes.jpg / og-sustainability.jpg / og-random.jpg, re-cropped
      to 1200x630 ONLY when their source photo changed (source identity =
      SHA-256 of the source bytes, kept in share-refresh-state.json).

Derivations are a faithful port of share-stubs/work/generate.py — the two
generators must agree byte-for-byte, and this script's idempotence test
(a clean run changes zero files) is what keeps them honest.

Book covers point at Goodreads' own og:image (Johnny: use the cover
Goodreads itself shows; pointed at, never re-hosted). Re-fetching 121
Goodreads pages every night would be rude and slow, so existing covers
are re-checked ONLY on Mondays (UTC weekday gate inside this script);
other nights a book's cover is carried over from its existing stub. A
brand-new book with no stub yet gets one fetch on any night — that is
creating, not re-checking. A failed fetch never loses a cover: the
previous value (or, for a new book, the JBO logo) is kept.

Engineering doorways (s/engineering/<id>.html) carry the entry's own
photo, derived exactly like the other photo pools (the entry's img run
through the stage-URL rule). Websites and Sci-Fi doorways
(s/websites/<id>.html, s/scifi/<id>.html) carry their entries' own
names, overviews and images the same way, derived from
websites-data.js and scifi-data.js — the two lazy pools the first
version of this refresher missed. The retired Math pool's doorways and
diagram PNGs (s/math/, s/img/math/) are no longer derived: they stay
in the tree as orphans, logged by the orphan pass, never deleted —
the same treatment the sea doorways got when Sea became Animals.

Finance doorways (s/finance/<TICKER>.html) carry that stock's own
chart snapshot — og-finance-<TICKER>.jpg, rendered nightly by
fetch_chart_data.py from the same weekly data the chart draws —
and land on the finance page with the chart showing that stock.

House rules:
    * Idempotent and quiet: an unchanged repo -> zero file changes,
      exit 0, a short summary in the log.
    * Never deletes: a stub whose item vanished from its source is
      listed in the run log and left in place (deletion is a human
      decision). New items get new stubs automatically.
    * Atomic writes (temp file + os.replace); a crash mid-run cannot
      leave a half-written stub or JPG.
    * Stdlib only, except Pillow for the three page-card crops. If
      Pillow is missing, stubs still refresh and the cards are skipped
      with a warning.

Exit status: 0 on any handled run (including per-item problems, which
are logged); 1 only when a required source file is missing/unreadable.
"""

import argparse
import base64
import hashlib
import html
import io
import json
import os
import re
import struct
import sys
import time
import urllib.request
from datetime import datetime, timezone
from html.parser import HTMLParser

SITE = 'https://johnny-oneal.com'
STATE_NAME = 'share-refresh-state.json'
UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
      'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36')

# Fallback image for any item with NO content image of its own — Johnny's
# ruling (2026-11-18): his JBO logo, never a page card.
LOGO = SITE + '/JBO%20Logo.%20green%20background.png'
LOGO_ALT = "Johnny O'Neal logo"

# The stub template is byte-identical to generate.py's — do not fork it.
STUB = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{title}</title>
<meta name="robots" content="noindex">
<meta name="description" content="{desc}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Johnny O'Neal">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{desc}">
<meta property="og:url" content="{stub_url}">
<meta property="og:image" content="{img}">{img_alt}{img_dims}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{title}">
<meta name="twitter:description" content="{desc}">
<meta name="twitter:image" content="{img}">
<meta http-equiv="refresh" content="0; url={target}">
<script>location.replace({target_js});</script>
</head>
<body>
<p><a href="{target}">Continue to Johnny O'Neal \u2014 {title}</a></p>
</body>
</html>
"""


def esc(s):
    return html.escape(s, quote=True)


def sha256(raw):
    return hashlib.sha256(raw).hexdigest()


# --------------------------------------------------------------------------
# A tiny tolerant DOM on the stdlib HTMLParser (the nightly runner has no
# lxml; generate.py used lxml, so this mirrors the queries it made).
# --------------------------------------------------------------------------
VOID_TAGS = {
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link',
    'meta', 'param', 'source', 'track', 'wbr',
}


class El:
    __slots__ = ('tag', 'attrs', 'children', 'parent')

    def __init__(self, tag, attrs, parent):
        self.tag = tag
        self.attrs = attrs
        self.children = []          # list of El | str, in document order
        self.parent = parent

    def get(self, name, default=None):
        return self.attrs.get(name, default)


class _DomBuilder(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = El('#root', {}, None)
        self.stack = [self.root]

    def _append(self, node):
        cur = self.stack[-1]
        if isinstance(node, str) and cur.children \
                and isinstance(cur.children[-1], str):
            cur.children[-1] += node       # keep text runs whole
        else:
            cur.children.append(node)

    def handle_starttag(self, tag, attrs):
        el = El(tag, dict(attrs), self.stack[-1])
        self._append(el)
        if tag not in VOID_TAGS:
            self.stack.append(el)

    def handle_startendtag(self, tag, attrs):
        self._append(El(tag, dict(attrs), self.stack[-1]))

    def handle_endtag(self, tag):
        # Pop to the nearest matching open element; ignore stray closers.
        for i in range(len(self.stack) - 1, 0, -1):
            if self.stack[i].tag == tag:
                del self.stack[i:]
                return

    def handle_data(self, data):
        if data:
            self._append(data)


def parse_html(text):
    b = _DomBuilder()
    b.feed(text)
    b.close()
    return b.root


def iter_desc(el):
    for child in el.children:
        if isinstance(child, El):
            yield child
            yield from iter_desc(child)


def has_class(el, name):
    return name in (el.attrs.get('class') or '').split()


def by_class(root, name):
    return [e for e in iter_desc(root) if has_class(e, name)]


def by_id(root, idval):
    for e in iter_desc(root):
        if e.attrs.get('id') == idval:
            return e
    return None


def text_of(el, skip_class=None):
    """lxml text_content(), whitespace-collapsed the way generate.py did."""
    parts = []

    def walk(node):
        for child in node.children:
            if isinstance(child, str):
                parts.append(child)
            elif skip_class and has_class(child, skip_class):
                continue
            else:
                walk(child)
    walk(el)
    return ' '.join(''.join(parts).split())


def leading_text(el):
    """lxml .text — the text node before the first child element."""
    if el.children and isinstance(el.children[0], str):
        return el.children[0]
    return ''


def tail_text(parent, el):
    """lxml .tail — the text run immediately after el inside its parent."""
    kids = parent.children
    for i, child in enumerate(kids):
        if child is el:
            if i + 1 < len(kids) and isinstance(kids[i + 1], str):
                return kids[i + 1]
            return ''
    return ''


# --------------------------------------------------------------------------
# Derivations ported from generate.py (must agree byte-for-byte)
# --------------------------------------------------------------------------
def stage_url(url):
    """Byte-faithful port of random.html's stageUrl(): the URL the stage
    actually serves for an entry (1280px Wikimedia rendition)."""
    if not url or '://thumb.wikimedia.org/' not in url:
        return url
    m = re.search(r'(\d+)px-([^/]+)$', url)
    if not m or int(m.group(1)) <= 1280:
        return url
    return url[:m.start()] + '1280px-' + m.group(2)


def trim_words(s, limit=200):
    if len(s) <= limit:
        return s, False
    cut = s[:limit].rsplit(' ', 1)[0].rstrip(' ,;:')
    return cut + '\u2026', True


def jpeg_size(raw):
    """(width, height) from JPEG SOF markers — the photo's native size."""
    i = 2  # skip SOI
    while i < len(raw) - 9:
        if raw[i] != 0xFF:
            i += 1
            continue
        marker = raw[i + 1]
        if marker in (0xC0, 0xC1, 0xC2):
            h, w = struct.unpack('>HH', raw[i + 5:i + 9])
            return w, h
        if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD9:
            i += 2
            continue
        seglen = struct.unpack('>H', raw[i + 2:i + 4])[0]
        i += 2 + seglen
    return None


def render_stub(rel_path, title, desc, img, target, img_wh=None):
    stub_url = SITE + '/s/' + rel_path.replace(os.sep, '/')
    img_alt = ('\n<meta property="og:image:alt" content="%s">' % LOGO_ALT
               if img == LOGO else '')
    img_dims = ''
    if img_wh:
        img_dims = ('\n<meta property="og:image:width" content="%d">'
                    '\n<meta property="og:image:height" content="%d">'
                    % img_wh)
    return STUB.format(
        title=esc(title), desc=esc(desc), img=esc(img), img_alt=img_alt,
        img_dims=img_dims, stub_url=esc(stub_url), target=esc(target),
        target_js=json.dumps(target))


# --------------------------------------------------------------------------
# File helpers — atomic, write-only-if-different
# --------------------------------------------------------------------------
def read_bytes(path):
    with open(path, 'rb') as f:
        return f.read()


def write_if_changed(path, raw, changes, label):
    """Write raw to path atomically iff it differs. Returns True if wrote."""
    if os.path.exists(path) and read_bytes(path) == raw:
        return False
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + '.tmp-refresh'
    with open(tmp, 'wb') as f:
        f.write(raw)
    os.replace(tmp, path)
    changes.append(label)
    return True


def existing_stub_image(path):
    """The og:image a stub currently declares (its cover cache)."""
    if not os.path.exists(path):
        return None
    m = re.search(r'property="og:image"\s+content="([^"]*)"',
                  read_bytes(path).decode('utf-8', 'replace'))
    return html.unescape(m.group(1)) if m else None


# --------------------------------------------------------------------------
# Network (stdlib urllib only, fetch_covers.py's manners)
# --------------------------------------------------------------------------
def fetch_url(url, timeout=30):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def fetch_goodreads_cover(grid):
    """The og:image of the book's own Goodreads page, or None.
    One retry after 4s, exactly as fetch_covers.py behaved."""
    url = 'https://www.goodreads.com/book/show/%s' % grid
    for attempt in (1, 2):
        try:
            body = fetch_url(url).decode('utf-8', 'replace')
            m = re.search(r'property="og:image"\s+content="([^"]+)"', body)
            if not m:
                m = re.search(r'content="([^"]+)"\s+property="og:image"',
                              body)
            if m:
                return m.group(1)
        except Exception:
            pass
        if attempt == 1:
            time.sleep(4)
    return None


# --------------------------------------------------------------------------
# The refresher
# --------------------------------------------------------------------------
class Refresher:
    def __init__(self, root, force_covers=False, cover_limit=0, log=print):
        self.root = root
        self.force_covers = force_covers
        self.cover_limit = cover_limit
        self.log = log
        self.changes = []        # labels of files written
        self.problems = []       # per-item problems (logged, non-fatal)
        self.class_failures = []  # derivation classes that wiped out
        self.derived_stubs = set()   # repo-relative stub paths derived
        self.counts = {}

    def path(self, *parts):
        return os.path.join(self.root, *parts)

    def read_source(self, name):
        p = self.path(name)
        if not os.path.exists(p):
            raise FileNotFoundError(name)
        return read_bytes(p).decode('utf-8')

    # ---- one stub ------------------------------------------------------
    def emit(self, kind, rel_path, title, desc, img, target, img_wh=None):
        body = render_stub(rel_path, title, desc, img, target, img_wh)
        self.derived_stubs.add('s/' + rel_path.replace(os.sep, '/'))
        self.counts[kind] = self.counts.get(kind, 0) + 1
        write_if_changed(self.path('s', rel_path),
                         body.encode('utf-8'), self.changes,
                         's/' + rel_path.replace(os.sep, '/'))

    def _step(self, name, fn, *args):
        """Run one derivation class, watching for a wipeout
        (2026-11-23 rule): three or more problems and not one
        stub derived means the class failed as a class — a
        source-format change, not three unlucky items. Recorded
        in class_failures; main() turns it into exit 1, so a
        whole class can no longer freeze behind a green run."""
        before_c = sum(self.counts.values())
        before_p = len(self.problems)
        out = fn(*args)
        if len(self.problems) - before_p >= 3 and \
                sum(self.counts.values()) == before_c:
            self.class_failures.append(name)
        return out

    # ---- recipes -------------------------------------------------------
    def derive_recipes(self, doc):
        """Returns {recipe_id: photo_bytes} for the page-card step."""
        photos = {}
        for w in by_class(doc, 'recipe-wrapper'):
            try:
                btn = by_class(w, 'recipe-share')
                rid = btn[0].get('data-share-recipe')
                title_el = by_class(w, 'recipe-card-title')[0]
                name = text_of(title_el, skip_class='standout-badge')
                photo = by_class(w, 'recipe-card-photo')
                src = photo[0].get('src') or ''
                assert src.startswith('data:'), 'photo not a data URI'
                mime, b64 = src[5:].split(';base64,', 1)
                assert mime == 'image/jpeg', 'photo mime %s' % mime
                raw = base64.b64decode(b64)
                photos[rid] = raw
                write_if_changed(self.path('s', 'img',
                                           'recipe-%s.jpg' % rid),
                                 raw, self.changes,
                                 's/img/recipe-%s.jpg' % rid)
                wh = jpeg_size(raw)
                self.emit('recipe', 'recipe/%s.html' % rid, name,
                          '%s \u2014 Johnny\u2019s Recipes' % name,
                          '%s/s/img/recipe-%s.jpg' % (SITE, rid),
                          '%s/recipes.html#%s' % (SITE, rid), img_wh=wh)
            except Exception as e:
                self.problems.append('recipe ?: %s' % e)
        return photos

    # ---- sustainability examples --------------------------------------
    def derive_examples(self, doc):
        for b in by_class(doc, 'example-share'):
            try:
                cid = b.get('data-share-card')
                card = by_id(doc, cid)
                wrap = card
                while wrap is not None and not has_class(
                        wrap, 'explainer-wrapper'):
                    wrap = wrap.parent
                t = by_class(wrap, 'example-toggle-text')[0]
                name = ' '.join((leading_text(t) or '').split())
                if not name:
                    name = text_of(by_class(card, 'example-name')[0])
                hook = text_of(by_class(wrap, 'example-hook')[0])
                imgs = [e for e in iter_desc(card) if e.tag == 'img']
                if imgs:
                    img = imgs[0].get('src')
                elif cid == 'exLoessCard':
                    after = [i for i in iter_desc(doc)
                             if i.tag == 'img'
                             and (i.get('alt') or '').startswith('After:')
                             and 'loess' in (i.get('alt') or '').lower()]
                    assert len(after) == 1
                    img = after[0].get('src')
                else:
                    img = LOGO
                self.emit('example', 'example/%s.html' % cid, name, hook,
                          img, '%s/sustainability.html#%s' % (SITE, cid))
            except Exception as e:
                self.problems.append('example ?: %s' % e)

    # ---- books ---------------------------------------------------------
    def derive_books(self, doc, cover_check):
        rows = [r for r in by_class(doc, 'bk-row')
                if by_class(r, 'bk-share')]
        checked = 0
        found = 0
        for r in rows:
            try:
                grid = by_class(r, 'bk-share')[0].get('data-share-book')
                stub_rel = 'book/%s.html' % grid
                cached = existing_stub_image(self.path('s', stub_rel))
                main = by_class(r, 'bk-main')[0]
                link = next(c for c in main.children
                            if isinstance(c, El) and c.tag == 'a')
                title = text_of(link)
                author = re.sub(r'^[\s\u2013-]+', '',
                                tail_text(main, link) or '').strip()
                rating = r.get('data-rating')
                desc = ('Johnny\u2019s rating: %s/5' % rating
                        if rating else title)
                img = None
                if cover_check and (not self.cover_limit
                                    or checked < self.cover_limit):
                    checked += 1
                    img = fetch_goodreads_cover(grid)
                    if img:
                        found += 1
                    time.sleep(2.5)     # fetch_covers.py's pacing
                if not img:
                    if cached:
                        img = cached            # keep the known cover
                    elif not cover_check:
                        # New book, no stub yet: one creating fetch.
                        img = fetch_goodreads_cover(grid) or LOGO
                        time.sleep(2.5)
                    else:
                        img = LOGO
                self.emit('book', stub_rel,
                          '%s \u2013 %s' % (title, author) if author
                          else title,
                          desc, img,
                          '%s/media.html#book=%s' % (SITE, grid))
            except Exception as e:
                self.problems.append('book ?: %s' % e)
        if cover_check:
            self.log('covers: re-checked %d, fresh og:image on %d'
                     % (checked, found))

    # ---- random pools, quotes, engineering, websites, sci-fi ---------
    def derive_random(self, random_src, quotes, eng_entries,
                      web_entries, scifi_entries):
        i = random_src.find('var POOLS = ')
        blob = random_src[i + len('var POOLS = '):
                          random_src.find('\n', i)].rstrip().rstrip(';')
        pools = json.loads(blob)
        pool_prefix = {'creatures': 'sea', 'paintings': 'art',
                       'architecture': 'arch', 'space': 'space'}
        carina_url = None
        for pool_key, prefix in pool_prefix.items():
            for e in pools.get(pool_key, []):
                try:
                    desc = (e.get('overview') or e.get('sub')
                            or e.get('name') or '')
                    desc = ' '.join(desc.split())
                    self.emit('random',
                              'random/%s/%s.html' % (prefix, e['id']),
                              e['name'], desc, stage_url(e['img']),
                              '%s/random.html#share/%s/%s'
                              % (SITE, prefix, e['id']))
                    if pool_key == 'space' and e['id'] == 'carina':
                        carina_url = stage_url(e['img'])
                except Exception as ex:
                    self.problems.append('random %s: %s'
                                         % (e.get('id', '?'), ex))
        for q in quotes:
            try:
                desc, _ = trim_words(' '.join(q['quote'].split()))
                self.emit('quote', 'quote/%s.html' % q['id'], q['name'],
                          desc, LOGO,
                          '%s/random.html#share/quotes/%s' % (SITE, q['id']))
            except Exception as ex:
                self.problems.append('quote ?: %s' % ex)
        for e in eng_entries:
            try:
                desc = (e.get('overview') or e.get('sub')
                        or e.get('name') or '')
                desc = ' '.join(desc.split())
                self.emit('engineering',
                          'engineering/%s.html' % e['id'],
                          e['name'], desc, stage_url(e['img']),
                          '%s/random.html#share/engineering/%s'
                          % (SITE, e['id']))
            except Exception as ex:
                self.problems.append('engineering ?: %s' % ex)
        for e in web_entries:
            try:
                desc = (e.get('overview') or e.get('sub')
                        or e.get('name') or '')
                desc = ' '.join(desc.split())
                self.emit('websites',
                          'websites/%s.html' % e['id'],
                          e['name'], desc, stage_url(e['img']),
                          '%s/random.html#share/websites/%s'
                          % (SITE, e['id']))
            except Exception as ex:
                self.problems.append('websites ?: %s' % ex)
        for e in scifi_entries:
            try:
                desc = (e.get('overview') or e.get('sub')
                        or e.get('name') or '')
                desc = ' '.join(desc.split())
                self.emit('scifi',
                          'scifi/%s.html' % e['id'],
                          e['name'], desc, stage_url(e['img']),
                          '%s/random.html#share/scifi/%s'
                          % (SITE, e['id']))
            except Exception as ex:
                self.problems.append('scifi ?: %s' % ex)
        return carina_url

    # ---- finance stocks -------------------------------------------------
    _FIN_MONTHS = ('Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                   'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec')
    _FIN_BENCH = {'SPX', 'IXIC', 'GOLD', 'BTC'}

    def derive_finance(self):
        """One doorway per stock of Johnny's 19 (s/finance/<TICKER>.html).

        The doorway declares that stock's own nightly chart snapshot —
        og-finance-<TICKER>.jpg, rendered by fetch_chart_data.py from
        the same weekly data — and lands on the finance page with the
        chart showing that stock. The stock set is the page's own:
        every series in finance-chart-data.json that is neither a
        benchmark pick nor a Nasdaq-100-only entry. An unreadable
        chart file skips only this derivation (a logged problem); the
        other doorways are never held hostage to it.
        """
        try:
            chart = json.loads(self.read_source('finance-chart-data.json'))
        except Exception as e:
            self.problems.append('finance: chart data unreadable (%s) '
                                 '— finance doorways skipped' % e)
            return
        series = chart.get('series') or {}
        for key in sorted(series):
            entry = series[key] or {}
            if key in self._FIN_BENCH or entry.get('ndx') \
                    or not entry.get('bars'):
                continue
            try:
                name = entry['name']
                title = name if name == key else '%s (%s)' % (name, key)
                last = entry['bars'][-1]
                y, m, d = last[0].split('-')
                desc = ('%s \u2014 the weekly price chart with its '
                        '50-week and 200-week averages. Latest close '
                        '$%s, week ending %s %d, %s. Finance & Markets '
                        '\u2014 Johnny O\u2019Neal.'
                        % (title, format(last[4], ',.2f'),
                           self._FIN_MONTHS[int(m) - 1], int(d), y))
                self.emit('finance', 'finance/%s.html' % key, title, desc,
                          '%s/og-finance-%s.jpg' % (SITE, key),
                          '%s/finance.html#chart=%s:weekly' % (SITE, key),
                          img_wh=(1200, 630))
            except Exception as ex:
                self.problems.append('finance %s: %s' % (key, ex))

    # ---- the three photo page-cards ------------------------------------
    def refresh_cards(self, recipe_photos, sust_doc, carina_url, state):
        try:
            from PIL import Image
        except ImportError:
            self.log('WARNING: Pillow not installed — page cards skipped '
                     '(stubs still refreshed).')
            return
        cards = state.setdefault('cards', {})

        def card(fname, raw):
            """Re-crop fname from source bytes raw iff the source changed
            (or the card is missing). raw=None means the source could not
            be obtained — keep the old card, say so."""
            if raw is None:
                self.log('card %s: source unavailable, kept as-is' % fname)
                return
            digest = sha256(raw)
            dest = self.path(fname)
            prev = cards.get(fname, {}).get('src_sha256')
            if prev == digest and os.path.exists(dest):
                return                      # source unchanged: no re-crop
            if prev is None and os.path.exists(dest):
                # First sight of this card: the shipped card WAS made from
                # the current source (og-cards build + Johnny's swaps), so
                # adopt it and record the source hash. No rewrite.
                cards[fname] = {'src_sha256': digest}
                self.log('card %s: adopted (source hash recorded)' % fname)
                return
            im = Image.open(io.BytesIO(raw)).convert('RGB')
            W, H = 1200, 630
            target = W / H
            w, h = im.size
            if w / h > target:
                nw = int(h * target)
                x = (w - nw) // 2
                im = im.crop((x, 0, x + nw, h))
            else:
                nh = int(w / target)
                y = (h - nh) // 2
                im = im.crop((0, y, w, y + nh))
            im = im.resize((W, H), Image.LANCZOS)
            tmp = dest + '.tmp-refresh'
            im.save(tmp, format='JPEG', quality=86)
            os.replace(tmp, dest)
            cards[fname] = {'src_sha256': digest}
            self.changes.append(fname)
            self.log('card %s: re-cropped (source photo changed)' % fname)

        # og-recipes.jpg follows the Peruvian Chicken photo (Johnny's pick
        # for the Cooking page card) wherever it appears in recipes.html.
        card('og-recipes.jpg', recipe_photos.get('peruvianRecipe'))
        # og-sustainability.jpg follows the Loess hero pair's "After" photo.
        loess_raw = None
        try:
            after = [i for i in iter_desc(sust_doc)
                     if i.tag == 'img'
                     and (i.get('alt') or '').startswith('After:')
                     and 'loess' in (i.get('alt') or '').lower()]
            if len(after) == 1:
                loess_raw = fetch_url(after[0].get('src'))
        except Exception as e:
            self.log('loess source fetch failed: %s' % e)
        card('og-sustainability.jpg', loess_raw)
        # og-random.jpg follows the Cosmos pool's Cosmic Cliffs entry.
        cliffs_raw = None
        if carina_url:
            try:
                cliffs_raw = fetch_url(carina_url)
            except Exception as e:
                self.log('cosmic cliffs source fetch failed: %s' % e)
        card('og-random.jpg', cliffs_raw)

    # ---- orphans ---------------------------------------------------------
    def log_orphans(self):
        sroot = self.path('s')
        for dirpath, _dirs, files in os.walk(sroot):
            for fn in files:
                if not fn.endswith('.html'):
                    continue
                rel = os.path.relpath(os.path.join(dirpath, fn),
                                      self.root).replace(os.sep, '/')
                if rel not in self.derived_stubs:
                    self.log('orphaned stub left in place (item no '
                             'longer in its source): %s' % rel)

    # ---- main ------------------------------------------------------------
    def run(self):
        recipes_doc = parse_html(self.read_source('recipes.html'))
        sust_doc = parse_html(self.read_source('sustainability.html'))
        media_doc = parse_html(self.read_source('media.html'))
        random_src = self.read_source('random.html')
        qsrc = self.read_source('quotes-data.js')
        quotes = json.loads(qsrc[qsrc.index('['):qsrc.rindex(']') + 1])
        esrc = self.read_source('engineering-data.js')
        eng_entries = json.loads(esrc[esrc.index('['):
                                      esrc.rindex(']') + 1])
        web_entries = []
        try:
            wsrc = self.read_source('websites-data.js')
            web_entries = json.loads(wsrc[wsrc.index('['):
                                          wsrc.rindex(']') + 1])
        except Exception as e:
            self.problems.append('websites: data unreadable (%s) '
                                 '\u2014 websites doorways skipped' % e)
        scifi_entries = []
        try:
            sfsrc = self.read_source('scifi-data.js')
            scifi_entries = json.loads(sfsrc[sfsrc.index('['):
                                             sfsrc.rindex(']') + 1])
        except Exception as e:
            self.problems.append('sci-fi: data unreadable (%s) '
                                 '\u2014 sci-fi doorways skipped' % e)

        state_path = self.path(STATE_NAME)
        state = {}
        if os.path.exists(state_path):
            try:
                state = json.loads(read_bytes(state_path)
                                   .decode('utf-8'))
            except Exception:
                # Never silent (2026-11-23): a corrupt state file
                # resets the cards' source-hash history, and the
                # adoption path in refresh_cards then trusts it.
                state = {}
                self.problems.append(
                    '%s unreadable — reset to {} (page cards '
                    're-adopt their current images)' % STATE_NAME)
        state_before = json.dumps(state, sort_keys=True)

        photos = self._step('recipes', self.derive_recipes, recipes_doc)
        self._step('examples', self.derive_examples, sust_doc)
        monday = datetime.now(timezone.utc).weekday() == 0
        cover_check = self.force_covers or monday
        self._step('books', self.derive_books, media_doc, cover_check)
        carina_url = self._step('random', self.derive_random,
                                random_src, quotes, eng_entries,
                                web_entries, scifi_entries)
        self._step('finance', self.derive_finance)
        self.refresh_cards(photos, sust_doc, carina_url, state)
        self.log_orphans()

        if json.dumps(state, sort_keys=True) != state_before:
            write_if_changed(state_path,
                             (json.dumps(state, indent=1, sort_keys=True)
                              + '\n').encode('utf-8'),
                             self.changes, STATE_NAME)
        return state


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--root', default=os.path.dirname(
        os.path.abspath(__file__)),
        help='repo checkout root (default: the script\'s directory)')
    ap.add_argument('--force-cover-check', action='store_true',
                    help='re-check Goodreads covers tonight, Monday or not')
    ap.add_argument('--cover-limit', type=int, default=0,
                    help='cap the cover re-check at N books (testing)')
    args = ap.parse_args(argv)

    started = time.time()
    r = Refresher(args.root, force_covers=args.force_cover_check,
                  cover_limit=args.cover_limit)
    try:
        r.run()
    except FileNotFoundError as e:
        print('ERROR: required source file missing: %s' % e)
        return 1
    print('share-stub refresh: %s derived %s'
          % (sum(r.counts.values()),
             ', '.join('%s %d' % (k, r.counts[k])
                       for k in sorted(r.counts))))
    if r.changes:
        print('changed %d file(s):' % len(r.changes))
        for c in r.changes:
            print('  %s' % c)
    else:
        print('changed 0 files — everything already current')
    for p in r.problems:
        print('PROBLEM (skipped, non-fatal): %s' % p)
    print('elapsed %.1fs' % (time.time() - started))
    if r.class_failures:
        # A whole derivation class produced nothing (2026-11-23
        # rule): the refresh is partial in a way a per-item
        # problem list cannot express — fail the run so it can
        # never pass as green. (The workflow step is
        # continue-on-error, so other builders' commits still
        # land; this step simply shows red.)
        print('ERROR: derivation class(es) wiped out: %s'
              % ', '.join(r.class_failures))
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
