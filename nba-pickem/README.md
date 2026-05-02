# St. G's NBA Pick'em 2026

Sister app to the NFL Pick'em. Same group of 12. Series picks. Underdogs pay.

## Scoring

| Round | Formula |
|---|---|
| First Round | 1 + seed |
| Conf Semis | 2 + seed |
| Conf Finals | 4 + seed |
| NBA Finals | 8 + seed |

Seeds never change. #6 Wolves stay a 6 even if they make the Finals.

## Locking

Each series locks once Game 1 tips off (admin marks tip-off). Admin can override unlock if needed.

## Setup (first time)

### 1. Push to GitHub

```cmd
cd C:\Users\jerin\Downloads\nba-pickem
git init
git add .
git commit -m "Initial NBA pickem"
git branch -M main
git remote add origin https://github.com/jerinvarkey/nba-pickem.git
git push -u origin main
```

(Create the repo on GitHub first as `jerinvarkey/nba-pickem`, empty.)

### 2. Create Supabase tables

Open your existing Supabase project (or make a new one). Go to SQL Editor and paste the contents of `supabase.sql`, then Run.

### 3. Deploy to Vercel

1. Go to vercel.com/new
2. Import `jerinvarkey/nba-pickem`
3. Add environment variables:
   - `NEXT_PUBLIC_SUPABASE_URL` - your Supabase URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` - your anon key
   - `NEXT_PUBLIC_ADMIN_PASSWORD` - whatever you want (defaults to `stgs2026`)
4. Deploy

## Local dev

```cmd
copy .env.local.example .env.local
```

Edit `.env.local` with your Supabase values, then:

```cmd
npm install
npm run dev
```

Open http://localhost:3000

## Entering everyone's picks (admin)

1. Sign in as admin (top right)
2. Switch the player selector to each person
3. Make their picks for them in Round 1
4. Repeat for each player

## Locking a series

When Game 1 tips off, sign in as admin, find the series, and click "Tip-off Game 1." That series is now locked for everyone.

## Setting winners

When a series ends, admin clicks the team's "wins series" button. Points apply automatically. You can also enter the series score (e.g. 4-1) in the admin row.

## How later rounds populate

You don't need to manually create Round 2 / Conf Finals / Finals matchups. As soon as you mark winners in Round 1, the Conf Semis cards fill in automatically with the advancing teams (correct seeds preserved). Same for CF and Finals.

## File map

```
app/page.tsx        Main UI - all tabs, picks, leaderboard, admin
app/globals.css     Light theme styles
app/layout.tsx      Root layout, fonts
lib/bracket.ts      Hardcoded teams + seeds + initial Round 1 + bracket resolver
lib/supabase.ts     Supabase client (implicit auth)
supabase.sql        Schema - paste into Supabase SQL editor
```
