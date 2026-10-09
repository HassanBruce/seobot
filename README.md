# seobot — tumhara SEO assistant (toolswhisper.io)

Ek banda jo hafte bhar SEO karta hai, bas tumhe har post pe 10 minute dene hain.

**Har Monday (khud):**
- Poori site ka **audit:** sitemap se har page, missing title/description, thin content, noindex, broken links, slow pages, duplicate titles
- **Search Console** se data: kaunsi queries pe rank 5–20 hai (page 1 ke qareeb), aur kahan rank achi hai magar clicks kam (title badlo)
- Usi data aur tumhare tools se **naye blog ideas**
- Telegram pe **weekly report**

**Hafte mein 3 dafa (Mon/Wed/Fri, khud):**
- Ek post likhta hai: **writer AI** tumhare tool ke saath asli examples likhta hai, phir **editor AI** fake claims hatata hai, ghalat code theek karta hai, AI wale cliché nikalta hai, score deta hai, aur list banata hai ke tumhe kya karna hai (screenshot, command test)
- Telegram: "Naya draft ready"

**Tum:** dashboard kholo → draft parho → screenshot lagao, apni baat add karo → **Approve & publish**.

### "Do AI se human banao" wala tareeqa kyun nahi
Google AI detector nahi chalata; woh dekhta hai ke page kaam ka hai ya nahi. Isliye ye bot humanizer nahi, **quality editor** use karta hai: har post tumhare kisi tool se judi hoti hai, asli examples ke saath, aur tumhare review ke baad hi publish hoti hai. AdSense approval aur ranking dono isi se aate hain. Hafte mein 3 achi posts, 50 khaali posts se behtar hain.

## Setup

### 1. Basic
```bash
cd seobot
cp .env.example .env && nano .env     # SITE_URL, AI_API_KEY, ADMIN_PASSWORD
docker compose up -d --build
```
Dashboard: `ssh -L 3400:localhost:3400 root@VPS_IP` → `http://localhost:3400`
Pehli dafa: **Run audit → New ideas → Write next post**.

### 2. Search Console (free, 10 minute, bohot faidemand)
1. **search.google.com/search-console** → site add karo (Domain property, DNS TXT record se verify)
2. **console.cloud.google.com** → wahi ya naya project → **APIs & Services → Library → "Google Search Console API" → Enable**
3. **IAM & Admin → Service Accounts → Create** → naam `seobot` → Done → us account pe **Keys → Add key → JSON** → file download
4. File ko VPS pe `seobot/secrets/gsc.json` rakho
5. Search Console → **Settings → Users and permissions → Add user** → service account ki email (`seobot@...iam.gserviceaccount.com`) → **Restricted** permission
6. `.env`: `GSC_SITE=sc-domain:toolswhisper.io` (URL-prefix property ho to `https://toolswhisper.io/`)

### 3. Publishing: tumhari site kaise post leti hai?
Teen options. Jo tumhari site pe fit ho:

**A) Next.js / MDX files** (blog posts repo mein `.mdx` files hain)
```
PUBLISH_MODE=folder
CONTENT_DIR=/site/content/blog      # container ke andar ka path
FILE_EXT=mdx
GIT_PUSH=true                        # commit + push → Vercel/CI khud deploy kare
```
`docker-compose.yml` mein repo mount karo (`- /root/toolswhisper:/site`). Push ke liye repo ka remote HTTPS + GitHub token wala ho.
Frontmatter: `title, description, slug, date, tags`. Tumhari site alag fields maangti ho to bata dena.

**B) Laravel** (posts database mein): ek chhota route banao jo JSON le ke post save kare:
```
PUBLISH_MODE=webhook
WEBHOOK_URL=https://toolswhisper.io/api/bot/posts
WEBHOOK_TOKEN=koi-lamba-secret
```
Bot bhejta hai: `{ title, slug, description, tags, content_markdown, status }` aur `Authorization: Bearer <token>` header. Route mein token check karna. Main ye route bhi likh dunga, bas Post model ka structure batao.

**C) Abhi kuch nahi** (`PUBLISH_MODE=none`): draft dashboard pe tayar milta hai, tum copy karke apne admin mein paste karo.

## Commands
```
docker compose exec seo node --no-warnings scripts/run.js audit
docker compose exec seo node --no-warnings scripts/run.js plan
docker compose exec seo node --no-warnings scripts/run.js write
docker compose exec seo node --no-warnings scripts/run.js report
```

## Tests
`npm test`: site, Search Console, Gemini aur webhook sab mock hain.
