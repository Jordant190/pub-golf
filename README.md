# ⛳ Pub Golf — Setup Guide

Get your free real-time pub golf scorecard live in ~10 minutes.

---

## Step 1 — Create a free Supabase project

1. Go to **https://supabase.com** and sign up (free, no credit card)
2. Click **"New Project"**
3. Name it `pub-golf`, choose any region, set a password
4. Wait ~2 minutes for it to spin up

---

## Step 2 — Set up the database

1. In your Supabase dashboard, click **"SQL Editor"** in the left sidebar
2. Click **"New query"**
3. Copy and paste the entire contents of **`schema.sql`** into the editor
4. Click **"Run"** (green button)

You should see "Success. No rows returned."

---

## Step 3 — Get your API keys

1. In Supabase, go to **Settings → API**
2. Copy two values:
   - **Project URL** — looks like `https://abcdefg.supabase.co`
   - **anon public key** — a long string starting with `eyJ...`

---

## Step 4 — Configure the app

1. In the `pub-golf` folder, duplicate `.env.example` and rename it to `.env`
2. Fill it in:

```
REACT_APP_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
REACT_APP_SUPABASE_ANON_KEY=eyJ...your_anon_key...
```

---

## Step 5 — Run locally (optional test)

```bash
npm install
npm start
```

Opens at http://localhost:3000 — test it works before deploying.

---

## Step 6 — Deploy free on Vercel

1. Go to **https://vercel.com** and sign up with GitHub
2. Push this folder to a GitHub repo (or use Vercel CLI)
3. Click **"Import Project"** → select your repo
4. Under **"Environment Variables"**, add:
   - `REACT_APP_SUPABASE_URL` → your Supabase URL
   - `REACT_APP_SUPABASE_ANON_KEY` → your anon key
5. Click **Deploy** — Vercel gives you a free URL like `pub-golf-abc.vercel.app`

---

## Step 7 — Share with friends

Send your Vercel URL to everyone. When you update scores on your phone:
- ✅ All phones see the update within ~1 second
- ✅ No refresh needed
- ✅ The green "Live" dot pulses when data changes

---

## How to play

1. Go to **Setup** first — add your players and name each bar + drink
2. Go to **Rules** — customize your penalty rules
3. During the crawl, use **Scorecard** — select the hole, tap +/− to count sips
4. Tap a red penalty button if someone breaks a rule
5. Check **Leaderboard** for standings at any time

**Lowest total score wins. Par is however many sips you expect — there's no par enforcement, just bragging rights.**

---

## Costs

| Service | Free tier |
|---------|-----------|
| Supabase | 500MB DB, 2 projects, unlimited realtime connections |
| Vercel | Unlimited deployments, custom domains, 100GB bandwidth |

Both are completely free for a night out with friends. 🍺
