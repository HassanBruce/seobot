"""Google Search Console: performance, opportunities, sitemaps and index status (read-only service account)."""
from datetime import date, timedelta

from . import config

SCOPES = ["https://www.googleapis.com/auth/webmasters.readonly"]


def service():
    from google.oauth2 import service_account
    from googleapiclient.discovery import build
    creds = service_account.Credentials.from_service_account_file(str(config.GSC_KEY_FILE), scopes=SCOPES)
    return build("searchconsole", "v1", credentials=creds, cache_discovery=False)


def _q(svc, prop, start, end, dims=(), limit=1000, filters=None):
    body = {"startDate": start.isoformat(), "endDate": end.isoformat(), "dimensions": list(dims), "rowLimit": limit}
    if filters:
        body["dimensionFilterGroups"] = [{"filters": filters}]
    return svc.searchanalytics().query(siteUrl=prop, body=body).execute().get("rows", [])


def _tot(rows):
    r = rows[0] if rows else {}
    return {k: r.get(k, 0) for k in ("clicks", "impressions", "ctr", "position")}


def performance(prop, sitemap_urls=(), inspect_urls=()):
    svc = service()
    end = date.today() - timedelta(days=3)          # Search Console data is ~2-3 days late
    start = end - timedelta(days=27)
    prev_end, prev_start = start - timedelta(days=1), start - timedelta(days=28)
    out = {"period": f"{start} to {end}", "now": _tot(_q(svc, prop, start, end)),
           "before": _tot(_q(svc, prop, prev_start, prev_end))}
    out["yesterday"] = _tot(_q(svc, prop, end, end))
    queries = _q(svc, prop, start, end, ["query"], 250)
    out["top_queries"] = [{"query": r["keys"][0], **{k: r[k] for k in ("clicks", "impressions", "ctr", "position")}}
                          for r in sorted(queries, key=lambda r: -r["impressions"])[:20]]
    pages = _q(svc, prop, start, end, ["page"], 1000)
    out["pages"] = [{"page": r["keys"][0], **{k: r[k] for k in ("clicks", "impressions", "ctr", "position")}} for r in pages]
    qp = _q(svc, prop, start, end, ["query", "page"], 2000)
    # page 1-2 of Google: a better title / more content can move these up
    out["striking"] = sorted([{"query": r["keys"][0], "page": r["keys"][1], "impressions": r["impressions"],
                               "clicks": r["clicks"], "position": round(r["position"], 1)}
                              for r in qp if 4 <= r["position"] <= 20 and r["impressions"] >= 5],
                             key=lambda x: -x["impressions"])[:25]
    out["low_ctr"] = sorted([p for p in out["pages"] if p["impressions"] >= 30 and p["ctr"] < 0.01 and p["position"] <= 30],
                            key=lambda x: -x["impressions"])[:15]
    seen = {p["page"].rstrip("/") for p in out["pages"]}
    out["no_impressions"] = [u for u in sitemap_urls if u.rstrip("/") not in seen]

    out["sitemaps"] = []
    try:
        for sm in svc.sitemaps().list(siteUrl=prop).execute().get("sitemap", []):
            out["sitemaps"].append({"path": sm.get("path"), "errors": int(sm.get("errors", 0)),
                                    "warnings": int(sm.get("warnings", 0)), "last": sm.get("lastDownloaded", ""),
                                    "submitted": sum(int(c.get("submitted", 0)) for c in sm.get("contents", []))})
    except Exception as e:
        out["sitemaps_error"] = str(e)[:200]

    out["inspected"] = []
    for u in inspect_urls:
        try:
            r = svc.urlInspection().index().inspect(body={"inspectionUrl": u, "siteUrl": prop}).execute()
            ir = r.get("inspectionResult", {}).get("indexStatusResult", {})
            out["inspected"].append({"url": u, "verdict": ir.get("verdict"), "coverage": ir.get("coverageState", ""),
                                     "last_crawl": ir.get("lastCrawlTime", ""), "canonical": ir.get("googleCanonical", "")})
        except Exception as e:
            out["inspected"].append({"url": u, "verdict": "ERROR", "coverage": str(e)[:120]})
    return out
