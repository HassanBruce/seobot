"""Technical audit of one site: sitemap -> every page -> on-page checks, broken links, site-wide checks."""
import re
import socket
import ssl
import time
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from urllib.parse import urljoin, urldefrag, urlparse
from xml.etree import ElementTree

import requests
from bs4 import BeautifulSoup

from . import config

# Legal, contact and listing pages are short by nature; Google does not rank them for content.
UTILITY = re.compile(r"/(contact|terms|privacy|affiliate-disclosure|disclaimer|cookies?|verify|search)(-[a-z-]+)?/?$"
                     r"|/page/\d+/?$|/(blog|journal)/(tag|topic)/[^/]+/?$|^/(blog|topics|guides|tools|notes|countries|ancient-sites-near)/?$", re.I)
SKIP_EXT = re.compile(r"\.(png|jpe?g|gif|webp|svg|ico|pdf|zip|mp4|mp3|css|js|xml|txt|json|woff2?)$", re.I)


def _session():
    s = requests.Session()
    s.headers["User-Agent"] = config.USER_AGENT
    return s


def sitemap_urls(sess, base):
    """All page URLs from robots.txt sitemaps (or /sitemap.xml), following sitemap indexes."""
    todo, seen, urls = [], set(), []
    try:
        robots = sess.get(urljoin(base, "/robots.txt"), timeout=20).text
        todo += re.findall(r"(?im)^\s*sitemap:\s*(\S+)", robots)
    except requests.RequestException:
        robots = ""
    if not todo:
        todo.append(urljoin(base, "/sitemap.xml"))
    while todo and len(urls) < config.MAX_PAGES * 3:
        sm = todo.pop(0)
        if sm in seen:
            continue
        seen.add(sm)
        try:
            root = ElementTree.fromstring(sess.get(sm, timeout=30).content)
        except (requests.RequestException, ElementTree.ParseError):
            continue
        locs = [e.text.strip() for e in root.iter() if e.tag.endswith("loc") and e.text]
        if root.tag.endswith("sitemapindex"):
            todo += locs
        else:
            urls += locs
    return list(dict.fromkeys(urls)), robots


def _check_page(sess, url, host):
    r = {"url": url, "status": 0, "issues": [], "links": set()}
    t0 = time.time()
    try:
        resp = sess.get(url, timeout=30, allow_redirects=True)
    except requests.RequestException as e:
        r["issues"].append(("error", "fetch", f"could not load: {type(e).__name__}"))
        return r
    r["ms"] = int((time.time() - t0) * 1000)
    r["status"] = resp.status_code
    r["kb"] = len(resp.content) // 1024
    if resp.history and resp.url.rstrip("/") != url.rstrip("/"):
        r["issues"].append(("error", "redirect", f"sitemap URL redirects to {resp.url}"))
    if resp.status_code >= 400:
        r["issues"].append(("error", "status", f"HTTP {resp.status_code}"))
        return r
    if "html" not in resp.headers.get("content-type", ""):
        return r
    soup = BeautifulSoup(resp.text, "html.parser")
    title = (soup.title.string or "").strip() if soup.title and soup.title.string else ""
    desc_tag = soup.find("meta", attrs={"name": "description"})
    desc = (desc_tag.get("content") or "").strip() if desc_tag else ""
    canon_tag = soup.find("link", rel="canonical")
    canon = canon_tag.get("href", "").strip() if canon_tag else ""
    robots = " ".join((m.get("content") or "") for m in soup.find_all("meta", attrs={"name": re.compile("^(robots|googlebot)$", re.I)})).lower()
    xrobots = resp.headers.get("x-robots-tag", "").lower()
    h1 = soup.find_all("h1")
    ld = soup.find_all("script", type="application/ld+json")
    for tag in soup(["script", "style", "noscript", "nav", "footer", "header"]):
        tag.decompose()
    words = len(re.findall(r"\w+", soup.get_text(" ")))
    imgs_no_alt = sum(1 for i in soup.find_all("img") if i.get("alt") is None)
    r.update(title=title, desc=desc, canonical=canon, words=words, h1=len(h1), jsonld=len(ld))

    add = lambda sev, kind, msg: r["issues"].append((sev, kind, msg))
    if "noindex" in robots or "noindex" in xrobots:
        add("error", "noindex", "page is in the sitemap but says noindex")
    if not title:
        add("error", "title", "missing <title>")
    elif len(title) > 65:
        add("warn", "title", f"title too long ({len(title)} chars, Google cuts at ~60)")
    elif len(title) < 20:
        add("warn", "title", f"title too short ({len(title)} chars)")
    if not desc:
        add("warn", "description", "missing meta description")
    elif len(desc) > 165:
        add("info", "description", f"meta description long ({len(desc)} chars)")
    elif len(desc) < 70:
        add("info", "description", f"meta description short ({len(desc)} chars)")
    if not canon:
        add("warn", "canonical", "no canonical tag")
    elif urldefrag(urljoin(url, canon))[0].rstrip("/") != url.rstrip("/"):
        add("error", "canonical", f"canonical points to another URL: {canon}")
    if len(h1) != 1:
        add("warn", "h1", f"{len(h1)} <h1> tags (should be 1)")
    if words < 250 and not UTILITY.search(urlparse(url).path):
        add("warn", "thin", f"thin content ({words} words)")
    if r["ms"] > 2500:
        add("warn", "speed", f"slow response ({r['ms']} ms)")
    if r["kb"] > 600:
        add("info", "weight", f"heavy HTML ({r['kb']} KB)")
    if imgs_no_alt:
        add("info", "alt", f"{imgs_no_alt} image(s) without alt text")
    if not ld:
        add("info", "schema", "no JSON-LD structured data")

    for a in BeautifulSoup(resp.text, "html.parser").find_all("a", href=True):
        href = urldefrag(urljoin(resp.url, a["href"]))[0]
        p = urlparse(href)
        if p.scheme in ("http", "https") and p.netloc == host and not SKIP_EXT.search(p.path):
            r["links"].add(href)
    return r


def _cert_days(host):
    try:
        ctx = ssl.create_default_context()
        with socket.create_connection((host, 443), timeout=10) as s, ctx.wrap_socket(s, server_hostname=host) as t:
            exp = datetime.strptime(t.getpeercert()["notAfter"], "%b %d %H:%M:%S %Y %Z").replace(tzinfo=timezone.utc)
        return (exp - datetime.now(timezone.utc)).days
    except Exception:
        return None


def run(site):
    base = site["url"].rstrip("/") + "/"
    host = urlparse(base).netloc
    sess = _session()
    urls, robots = sitemap_urls(sess, base)
    site_issues = []
    if not urls:
        site_issues.append(("error", "sitemap", "no sitemap or it is empty"))
    if re.search(r"(?im)^\s*disallow:\s*/\s*$", robots):
        site_issues.append(("error", "robots", "robots.txt blocks the whole site (Disallow: /)"))
    days = _cert_days(host)
    if days is not None and days < 14:
        site_issues.append(("error", "ssl", f"SSL certificate expires in {days} days"))
    try:
        if sess.get(urljoin(base, "/ads.txt"), timeout=15).status_code != 200:
            site_issues.append(("warn", "ads.txt", "no /ads.txt (needed for AdSense)"))
    except requests.RequestException:
        pass
    for p in ("/privacy", "/about", "/contact"):
        if not any(p in urlparse(u).path.rstrip("/") for u in urls):    # also /privacy-policy, /contact-us
            site_issues.append(("info", "pages", f"no {p} page in the sitemap (AdSense reviewers look for it)"))

    pages_to_check = urls[: config.MAX_PAGES]
    with ThreadPoolExecutor(6) as ex:
        pages = list(ex.map(lambda u: _check_page(sess, u, host), pages_to_check))

    # duplicates
    for field, label in (("title", "title"), ("desc", "meta description")):
        cnt = Counter(p.get(field) for p in pages if p.get(field))
        for p in pages:
            if p.get(field) and cnt[p[field]] > 1:
                p["issues"].append(("warn", f"duplicate-{field}", f"same {label} as {cnt[p[field]] - 1} other page(s)"))

    # broken internal links (links found on pages that are not in the sitemap)
    in_sitemap = {u.rstrip("/") for u in urls}
    found_on = defaultdict(set)
    for p in pages:
        for l in p.pop("links", set()):
            if l.rstrip("/") not in in_sitemap:
                found_on[l].add(p["url"])
    broken = []

    def head(u):
        try:
            rr = sess.head(u, timeout=20, allow_redirects=True)
            if rr.status_code in (405, 403):
                rr = sess.get(u, timeout=20)
            return u, rr.status_code
        except requests.RequestException:
            return u, 0
    with ThreadPoolExecutor(6) as ex:
        for u, code in ex.map(head, list(found_on)[: config.MAX_LINK_CHECKS]):
            if code >= 400 or code == 0:
                broken.append({"url": u, "status": code, "on": sorted(found_on[u])[:3]})

    return {"site": site["name"], "url": base, "sitemap_count": len(urls), "checked": len(pages),
            "pages": pages, "site_issues": site_issues, "broken_links": broken, "cert_days": days,
            "avg_ms": int(sum(p.get("ms", 0) for p in pages) / max(1, len(pages)))}
