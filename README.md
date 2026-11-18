# seobot: roz ki SEO report (4 sites)

Har subah server par chalta hai aur **dono emails par ek report** bhejta hai. Sites par khud kuch change nahi karta (sirf report + suggestions).

**Har site ke liye:**
- **Technical check:** sitemap ka har page: HTTP errors, redirects, noindex, title/description (missing, lambi, duplicate), canonical, H1, thin content, slow pages, JSON-LD, image alt, broken internal links, SSL expiry, robots.txt, ads.txt, privacy/about/contact pages.
- **Google Search Console:** 28 din ke clicks/impressions/CTR/position (pichle 28 din se muqabla), top searches, page 1 ke qareeb queries (position 4-20), impressions hain magar clicks nahi, kabhi na dikhne wale pages, sitemap status, aur roz 20 pages ka index check (URL Inspection).
- **Gemini suggestions:** summary, aaj kya karein, naye titles/descriptions, content behtar karne ki jagah, naye blog ideas (outline ke saath), backlink/guest post ideas.
- Kal se kitne masle **naye** aaye aur kitne **fix** hue.
- YouTube bot (TubeBot) ki pichle 24 ghante ki videos.

## Setup (server)
```
/var/www/seobot/
  secrets/gsc.json     # Google service account key (Search Console: Restricted user on each site)
  src/                 # this repo
  src/.env             # copy of .env.example, filled
```
```bash
cd /var/www/seobot/src
docker compose build
docker compose run --rm seobot --test-email   # test
docker compose run --rm seobot                # full run + email
docker compose run --rm seobot --no-email     # writes data/last-report.html only
```
Cron: `/etc/cron.d/seobot` roz 07:30 (server time, Asia/Karachi).

Sites badalne hon to `sites.json` edit karein (name, url, gsc property, notes).

## Quota
- Search Console API: free (URL Inspection 2000/day per site, bot 20 use karta hai).
- Gemini: din mein 4 calls (har site ki 1). Free tier kaafi hai.
