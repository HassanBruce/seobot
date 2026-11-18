"""Gemini turns the audit + Search Console data into a short list of suggestions per site."""
import json
import re
import time

from . import config


def ask_json(prompt, temperature=0.4):
    if not config.GEMINI_API_KEY:
        raise RuntimeError("GEMINI_API_KEY is not set")
    from google import genai
    client = genai.Client(api_key=config.GEMINI_API_KEY, http_options={"timeout": 150_000})
    last = None
    for model in config.GEMINI_MODELS:
        for attempt in range(3):
            try:
                r = client.models.generate_content(model=model, contents=prompt, config={
                    "response_mime_type": "application/json", "temperature": temperature, "max_output_tokens": 16384})
                t = re.sub(r"^```(?:json)?\s*|\s*```$", "", (r.text or "").strip())
                return json.loads(t), model
            except ValueError as e:
                last = e
            except Exception as e:
                last = e
                msg = str(e)
                if any(x in msg for x in ("429", "RESOURCE_EXHAUSTED", "404", "imed out", "imeout", "504", "DEADLINE")):
                    break                       # quota, missing model or too slow: try the next model
                time.sleep(15 * (attempt + 1))
    raise RuntimeError(f"Gemini failed: {str(last)[:300]}")


def suggestions(site, audit, perf):
    pages = {p["url"].rstrip("/"): p for p in audit["pages"]}
    low_ctr = [{**p, "title": pages.get(p["page"].rstrip("/"), {}).get("title", ""),
                "desc": pages.get(p["page"].rstrip("/"), {}).get("desc", "")} for p in (perf or {}).get("low_ctr", [])[:8]]
    issue_counts = {}
    for p in audit["pages"]:
        for sev, kind, _ in p["issues"]:
            issue_counts[f"{sev}:{kind}"] = issue_counts.get(f"{sev}:{kind}", 0) + 1
    data = {
        "site": site["url"], "about": site.get("notes", ""),
        "pages_in_sitemap": audit["sitemap_count"], "issue_counts": issue_counts,
        "site_issues": audit["site_issues"], "broken_links": len(audit["broken_links"]),
        "search_console_28_days": (perf or {}).get("now"), "previous_28_days": (perf or {}).get("before"),
        "top_queries": (perf or {}).get("top_queries", [])[:15],
        "near_page_one": (perf or {}).get("striking", [])[:15],
        "pages_with_impressions_but_no_clicks": low_ctr,
        "pages_never_shown_in_google": len((perf or {}).get("no_impressions", [])),
        "not_indexed_sample": [i for i in (perf or {}).get("inspected", []) if i.get("verdict") != "PASS"][:10],
        "existing_titles": [p.get("title") for p in audit["pages"] if p.get("title")][:120],
    }
    prompt = f"""You are a senior SEO consultant. The owner runs this site for Google AdSense and guest posting income.
The site is 1-2 months old, so Google still tests it. Give honest, specific advice based ONLY on the data below.
Never invent numbers. Prefer actions that bring clicks within weeks. Write all text in {config.REPORT_LANG}.

DATA:
{json.dumps(data, ensure_ascii=False, default=str)[:60000]}

Return JSON:
{{
 "summary": "3-4 sentences: how the site is doing, the main reason for few clicks, the single most important thing to do",
 "quick_wins": ["5-8 concrete actions, most important first, each names the page or query it is about"],
 "title_rewrites": [{{"url": "...", "suggested_title": "<= 60 chars, includes the query people search", "suggested_description": "<= 155 chars", "why": "..."}}],
 "blog_ideas": [{{"title": "...", "target_query": "a real query from the data if possible", "outline": ["4-6 H2 headings"], "why": "..."}}],
 "content_to_improve": [{{"url": "...", "what": "what to add so it can reach page 1 for the query"}}],
 "backlinks": ["2-3 realistic ideas for guest posts or links for this niche"]
}}
Give 3-6 title_rewrites (only for pages in the data), 3 blog_ideas that are not already covered by existing_titles,
and up to 5 content_to_improve. If there is no Search Console data, base ideas on the audit."""
    out, model = ask_json(prompt)
    out["model"] = model
    return out
