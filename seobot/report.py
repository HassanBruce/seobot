"""Daily HTML email: one section per site, plus YouTube bot activity."""
import html
import smtplib
import ssl
from email.message import EmailMessage

from . import config

E = lambda s: html.escape(str(s if s is not None else ""))
SEV = {"error": ("#b42318", "Error"), "warn": ("#b54708", "Warning"), "info": ("#475467", "Info")}


def _pct(a, b):
    if not b:
        return ""
    d = (a - b) / b * 100
    color = "#067647" if d >= 0 else "#b42318"
    return f' <span style="color:{color}">({d:+.0f}%)</span>'


def _table(head, rows):
    th = "".join(f'<th style="text-align:left;padding:6px 8px;border-bottom:1px solid #ddd;font-size:12px;color:#555">{E(h)}</th>' for h in head)
    tr = "".join("<tr>" + "".join(f'<td style="padding:6px 8px;border-bottom:1px solid #eee;font-size:13px;vertical-align:top">{c}</td>' for c in r) + "</tr>" for r in rows)
    return f'<table style="border-collapse:collapse;width:100%;margin:6px 0 14px">{th and "<tr>" + th + "</tr>"}{tr}</table>'


def _short(url, base):
    return E(url.replace(base.rstrip("/"), "") or "/")


def site_section(s):
    a, p, ai, diff = s["audit"], s.get("perf"), s.get("ai") or {}, s.get("diff", {})
    base = a["url"]
    h = [f'<h2 style="margin:28px 0 4px;font-size:20px;border-top:3px solid #111;padding-top:14px">{E(a["site"])} '
         f'<a href="{E(base)}" style="font-size:13px;font-weight:normal">{E(base)}</a></h2>']
    if p:
        n, b, y = p["now"], p["before"], p["yesterday"]
        h.append(_table(["Last 28 days", "Clicks", "Impressions", "CTR", "Avg position"], [[
            E(p["period"]), f'{n["clicks"]:.0f}{_pct(n["clicks"], b["clicks"])}',
            f'{n["impressions"]:.0f}{_pct(n["impressions"], b["impressions"])}', f'{n["ctr"] * 100:.2f}%',
            f'{n["position"]:.1f}']]) + f'<p style="font-size:13px;margin:0 0 8px">Latest day: {y["clicks"]:.0f} clicks, {y["impressions"]:.0f} impressions.</p>')
    elif s.get("perf_error"):
        h.append(f'<p style="color:#b42318">Search Console: {E(s["perf_error"])}</p>')
    if ai.get("summary"):
        h.append(f'<p style="background:#f4f6fb;padding:10px 12px;border-radius:8px;font-size:14px">{E(ai["summary"])}</p>')

    errors = sum(1 for pg in a["pages"] for i in pg["issues"] if i[0] == "error") + sum(1 for i in a["site_issues"] if i[0] == "error")
    warns = sum(1 for pg in a["pages"] for i in pg["issues"] if i[0] == "warn")
    h.append(f'<p style="font-size:13px">Checked {a["checked"]} of {a["sitemap_count"]} sitemap pages · avg response {a["avg_ms"]} ms · '
             f'<b style="color:#b42318">{errors} errors</b> · <b style="color:#b54708">{warns} warnings</b> · '
             f'{len(a["broken_links"])} broken links'
             + (f' · SSL ok for {a["cert_days"]} days' if a.get("cert_days") is not None else "")
             + (f' · <b>{diff.get("new", 0)} new</b>, {diff.get("fixed", 0)} fixed since yesterday' if diff else "") + "</p>")

    if ai.get("quick_wins"):
        h.append('<h3 style="font-size:15px;margin:14px 0 4px">Aaj kya karein (suggestions)</h3><ol style="font-size:14px;margin-top:4px">'
                 + "".join(f"<li style='margin-bottom:4px'>{E(x)}</li>" for x in ai["quick_wins"]) + "</ol>")

    rows = []
    for sev, kind, msg in a["site_issues"]:
        rows.append((sev, "(whole site)", kind, msg))
    for pg in a["pages"]:
        for sev, kind, msg in pg["issues"]:
            rows.append((sev, pg["url"], kind, msg))
    for bl in a["broken_links"]:
        rows.append(("error", bl["on"][0] if bl["on"] else "", "broken link", f'{bl["url"]} → HTTP {bl["status"] or "no answer"}'))
    rows.sort(key=lambda r: ["error", "warn", "info"].index(r[0]))
    shown = [r for r in rows if r[0] != "info"][:40]
    if shown:
        h.append('<h3 style="font-size:15px;margin:14px 0 4px">Masle (technical)</h3>' + _table(
            ["", "Page", "Problem"],
            [[f'<span style="color:{SEV[r[0]][0]};font-weight:bold">{SEV[r[0]][1]}</span>',
              f'<a href="{E(r[1])}">{_short(r[1], base)}</a>' if r[1].startswith("http") else E(r[1]), E(r[3])] for r in shown]))
        more = len([r for r in rows if r[0] != "info"]) - len(shown)
        if more > 0:
            h.append(f'<p style="font-size:12px;color:#666">+{more} more warnings not shown.</p>')
    info = Counter_info(rows)
    if info:
        h.append(f'<p style="font-size:12px;color:#666">Minor: {E(info)}</p>')

    if p and p.get("inspected"):
        bad = [i for i in p["inspected"] if i.get("verdict") != "PASS"]
        h.append(f'<p style="font-size:13px">Google index check today: {len(p["inspected"]) - len(bad)} of {len(p["inspected"])} sampled pages are indexed.</p>')
        if bad:
            h.append(_table(["Not indexed", "Google says"], [[f'<a href="{E(i["url"])}">{_short(i["url"], base)}</a>', E(i["coverage"])] for i in bad[:12]]))
    if p and p.get("no_impressions"):
        h.append(f'<p style="font-size:13px">{len(p["no_impressions"])} sitemap pages got zero impressions in 28 days.</p>')
    if p and p.get("striking"):
        h.append('<h3 style="font-size:15px;margin:14px 0 4px">Page 1 ke qareeb (position 4-20)</h3>' + _table(
            ["Query", "Page", "Pos", "Impr", "Clicks"],
            [[E(x["query"]), f'<a href="{E(x["page"])}">{_short(x["page"], base)}</a>', x["position"], f'{x["impressions"]:.0f}', f'{x["clicks"]:.0f}']
             for x in p["striking"][:10]]))
    if p and p.get("top_queries"):
        h.append('<h3 style="font-size:15px;margin:14px 0 4px">Top searches</h3>' + _table(
            ["Query", "Impr", "Clicks", "Pos"],
            [[E(x["query"]), f'{x["impressions"]:.0f}', f'{x["clicks"]:.0f}', f'{x["position"]:.1f}'] for x in p["top_queries"][:10]]))
    if ai.get("title_rewrites"):
        h.append('<h3 style="font-size:15px;margin:14px 0 4px">Title / description badlein</h3>' + _table(
            ["Page", "New title + description", "Why"],
            [[f'<a href="{E(x.get("url"))}">{_short(x.get("url", ""), base)}</a>',
              f'<b>{E(x.get("suggested_title"))}</b><br><span style="color:#555">{E(x.get("suggested_description"))}</span>', E(x.get("why"))]
             for x in ai["title_rewrites"]]))
    if ai.get("content_to_improve"):
        h.append('<h3 style="font-size:15px;margin:14px 0 4px">Content behtar karein</h3><ul style="font-size:14px">' + "".join(
            f'<li><a href="{E(x.get("url"))}">{_short(x.get("url", ""), base)}</a>: {E(x.get("what"))}</li>' for x in ai["content_to_improve"]) + "</ul>")
    if ai.get("blog_ideas"):
        h.append('<h3 style="font-size:15px;margin:14px 0 4px">Naye blog post ideas</h3>' + "".join(
            f'<div style="margin-bottom:10px;font-size:14px"><b>{E(x.get("title"))}</b><br>'
            f'<span style="color:#555">Query: {E(x.get("target_query"))} · {E(x.get("why"))}</span>'
            f'<ul style="margin:4px 0">{"".join(f"<li>{E(o)}</li>" for o in x.get("outline", []))}</ul></div>' for x in ai["blog_ideas"]))
    if ai.get("backlinks"):
        h.append('<h3 style="font-size:15px;margin:14px 0 4px">Backlinks / guest posts</h3><ul style="font-size:14px">'
                 + "".join(f"<li>{E(x)}</li>" for x in ai["backlinks"]) + "</ul>")
    if s.get("ai_error"):
        h.append(f'<p style="font-size:12px;color:#b42318">AI suggestions failed today: {E(s["ai_error"])}</p>')
    return "".join(h)


def Counter_info(rows):
    c = {}
    for r in rows:
        if r[0] == "info":
            c[r[2]] = c.get(r[2], 0) + 1
    return ", ".join(f"{k} ×{v}" for k, v in sorted(c.items(), key=lambda x: -x[1]))


def youtube_section(yt):
    if not yt:
        return ""
    rows = [[E(j["kind"]), E(j["title"] or j["topic"]), E(j["status"]),
             f'<a href="https://studio.youtube.com/video/{E(j["youtube_id"])}/edit">Studio</a>' if j["youtube_id"] else E(j["error"])[:120]]
            for j in yt]
    return '<h2 style="margin:28px 0 4px;font-size:20px;border-top:3px solid #111;padding-top:14px">YouTube bot (last 24 h)</h2>' + _table(
        ["Type", "Video", "Status", ""], rows)


def build(results, yt, date_str):
    totals = [(r["audit"]["site"], (r.get("perf") or {}).get("now", {})) for r in results]
    head = _table(["Site", "Clicks (28d)", "Impressions (28d)", "Errors"],
                  [[E(n), f'{t.get("clicks", 0):.0f}', f'{t.get("impressions", 0):.0f}',
                    str(sum(1 for pg in r["audit"]["pages"] for i in pg["issues"] if i[0] == "error") + len(r["audit"]["broken_links"]))]
                   for (n, t), r in zip(totals, results)])
    body = (f'<div style="font-family:Arial,Helvetica,sans-serif;max-width:860px;color:#111">'
            f'<h1 style="font-size:22px;margin:0 0 6px">SEO report · {E(date_str)}</h1>'
            f'<p style="font-size:13px;color:#555;margin:0 0 10px">Daily check of all sites. Suggestions only: nothing was changed on the sites.</p>'
            + head + "".join(site_section(r) for r in results) + youtube_section(yt)
            + '<p style="font-size:11px;color:#888;margin-top:30px">seobot · runs every morning on the server · data: own crawl + Google Search Console (2-3 days late)</p></div>')
    return body


def send(subject, html_body, text="Open this email in HTML view."):
    if not (config.SMTP_USER and config.SMTP_PASSWORD and config.REPORT_TO):
        raise RuntimeError("SMTP_USER, SMTP_PASSWORD and REPORT_TO must be set")
    m = EmailMessage()
    m["Subject"], m["From"], m["To"] = subject, f"SEO Bot <{config.SMTP_USER}>", ", ".join(config.REPORT_TO)
    m.set_content(text)
    m.add_alternative(html_body, subtype="html")
    with smtplib.SMTP(config.SMTP_HOST, config.SMTP_PORT, timeout=60) as s:
        s.starttls(context=ssl.create_default_context())
        s.login(config.SMTP_USER, config.SMTP_PASSWORD)
        s.send_message(m)
