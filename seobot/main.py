"""Daily run: audit + Search Console + Gemini suggestions for every site, then one email.

    python -m seobot.main            # full run + email
    python -m seobot.main --no-email # write data/last-report.html only
    python -m seobot.main --test-email
"""
import json
import logging
import sqlite3
import sys
import time
import traceback
from datetime import date

from . import ai, audit, config, gsc, report

log = logging.getLogger("seobot")


def _state():
    f = config.DATA_DIR / "state.json"
    try:
        return json.loads(f.read_text())
    except (OSError, ValueError):
        return {}


def _save_state(st):
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    f = config.DATA_DIR / "state.json"
    f.with_suffix(".tmp").write_text(json.dumps(st, indent=1))
    f.with_suffix(".tmp").replace(f)


def _issue_keys(a):
    keys = {f"site|{k}|{m}" for s, k, m in a["site_issues"] if s != "info"}
    keys |= {f'{p["url"]}|{k}' for p in a["pages"] for s, k, _ in p["issues"] if s != "info"}
    keys |= {f'broken|{b["url"]}' for b in a["broken_links"]}
    return keys


def youtube_activity():
    if not config.TUBEBOT_DB:
        return []
    try:
        con = sqlite3.connect(f"file:{config.TUBEBOT_DB}?mode=ro", uri=True, timeout=10)
        con.row_factory = sqlite3.Row
        rows = con.execute("SELECT kind,title,topic,status,youtube_id,error FROM jobs WHERE updated > ? ORDER BY id",
                           (time.time() - 86400,)).fetchall()
        return [dict(r) for r in rows]
    except Exception as e:
        log.warning("tubebot db: %s", e)
        return []


def run_site(site, st):
    res = {"audit": audit.run(site)}
    a = res["audit"]
    sst = st.setdefault(site["name"], {})
    if site.get("gsc"):
        urls = [p["url"] for p in a["pages"] if p["status"] == 200]
        cur = sst.get("inspect_cursor", 0) % max(1, len(urls))
        batch = (urls[cur:] + urls[:cur])[: config.INSPECT_PER_DAY]
        sst["inspect_cursor"] = cur + len(batch)
        try:
            res["perf"] = gsc.performance(site["gsc"], [p["url"] for p in a["pages"]], batch)
        except Exception as e:
            res["perf_error"] = str(e)[:300]
            log.warning("gsc %s: %s", site["name"], e)
    keys = _issue_keys(a)
    if "issues" in sst:
        old = set(sst["issues"])
        res["diff"] = {"new": len(keys - old), "fixed": len(old - keys)}
    sst["issues"] = sorted(keys)
    if res.get("perf"):
        sst.setdefault("history", {})[date.today().isoformat()] = res["perf"]["now"]
        sst["history"] = dict(sorted(sst["history"].items())[-90:])
    try:
        res["ai"] = ai.suggestions(site, a, res.get("perf"))
    except Exception as e:
        res["ai_error"] = str(e)[:300]
        log.warning("ai %s: %s", site["name"], e)
    return res


def main(argv):
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    if "--test-email" in argv:
        report.send("SEO bot: test email", "<p>Test email from seobot. Daily reports will arrive like this.</p>")
        print("sent")
        return 0
    st = _state()
    results = []
    for site in config.sites():
        log.info("site %s", site["name"])
        try:
            results.append(run_site(site, st))
        except Exception:
            log.error("site %s failed: %s", site["name"], traceback.format_exc())
            results.append({"audit": {"site": site["name"], "url": site["url"], "pages": [], "checked": 0, "sitemap_count": 0,
                                      "site_issues": [("error", "bot", "the check crashed, see server log")],
                                      "broken_links": [], "avg_ms": 0, "cert_days": None}})
    _save_state(st)
    today = date.today().strftime("%d %b %Y")
    html_body = report.build(results, youtube_activity(), today)
    (config.DATA_DIR / "last-report.html").write_text(html_body)
    if "--no-email" not in argv:
        clicks = sum((r.get("perf") or {}).get("now", {}).get("clicks", 0) for r in results)
        errors = sum(sum(1 for p in r["audit"]["pages"] for i in p["issues"] if i[0] == "error") + len(r["audit"]["broken_links"])
                     for r in results)
        report.send(f"SEO report {today}: {clicks:.0f} clicks (28d), {errors} errors", html_body)
        log.info("report sent to %s", ", ".join(config.REPORT_TO))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
