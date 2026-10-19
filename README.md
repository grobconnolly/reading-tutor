# Connolly Reading Coach

A web app where Coach Juno listens to Stella and Penny read out loud, helps with tricky words, checks comprehension, adjusts difficulty, and tracks a weekly reward. The full build spec is in [reading-program.md](reading-program.md); the original single-file prototype is [index.html](index.html).

## Milestones

1. **Port to Next.js on Vercel** (this version): version 1's screens and flows, two reader profiles, browser speech, localStorage.
2. Supabase: parent magic-link login, hashed PINs, tables with RLS, synced data.
3. Azure Pronunciation Assessment for reading and word practice.
4. Azure neural TTS for Juno's voice.
5. Anthropic routes for new stories and coach notes.
6. Reward polish: Brevo notification, paid-week history, weekly email.

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000. The reader app is at `/`, the parent dashboard at `/parent`.

Listening uses the browser's built-in speech recognition, so test in Chrome or Safari. Away from `localhost` the page must be served over https for the microphone to work.

## Test and build

```bash
npm test        # Vitest: word alignment, scoring, leveling, check routing, Pacific-time week boundary
npm run build   # production build (also type-checks)
```

## Deploy to Vercel

1. In Vercel, **Add New Project** and import `grobconnolly/reading-tutor`. The Next.js defaults are correct; no environment variables are needed for milestone 1.
2. Every push to `main` redeploys. Open the production URL on the iPad in Safari and allow the microphone on the first "Start reading" tap.

## Where things live

- `src/lib/passages.ts` – the 14 library passages, level labels, grade benchmarks
- `src/lib/words.ts` – word matching and the lookahead alignment used while she reads
- `src/lib/scoring.ts` – accuracy, WCPM, stars, leveling, reading-check routing (all thresholds in `RULES`)
- `src/lib/time.ts` – Monday-to-Sunday reward weeks in America/Los_Angeles
- `src/lib/store.ts` – per-reader state in localStorage (milestone 2 moves this to Supabase)
- `src/components/ReaderApp.tsx` – the reader state machine: login, home, read, word practice, quiz, results
- `src/components/parent/ParentDashboard.tsx` – the parent view

Grade labels appear only in the parent view. Reader screens never show them.
