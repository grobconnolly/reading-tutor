# Connolly Reading Coach

A web app where Coach Juno listens to Stella and Penny read out loud, helps with tricky words, checks comprehension, adjusts difficulty, and tracks a weekly reward. The full build spec is in [reading-program.md](reading-program.md); the original single-file prototype is [index.html](index.html).

## Milestones

1. Port to Next.js on Vercel: version 1's screens and flows, two reader profiles, browser speech.
2. **Supabase** (this version): parent magic-link login, hashed PINs checked on the server, every table behind Row Level Security, progress synced across devices.
3. Azure Pronunciation Assessment for reading and word practice.
4. Azure neural TTS for Juno's voice (done; see "Juno's voice" below).
5. Anthropic routes for new stories and coach notes.
6. Reward polish: Brevo notification, paid-week history, weekly email.

## How signing in works

- **The parent** signs in once per device with an email magic link (`/login`). That device then shows both girls' name tiles.
- **Stella or Penny** taps her tile and types her 4-digit PIN. PINs are bcrypt-hashed in the database and checked by `POST /api/verify-pin`, 5 tries per minute.
- **The parent view** (`/parent`) asks for the parent PIN on top of the sign-in, so the girls can't open it on a shared device.
- Everything a reader does (sessions, tricky words, level, reward weeks) is saved to Supabase through `POST /api/sessions`, so progress looks the same on the iPad and on the parent's phone.

## Supabase setup (once)

1. Create a project at supabase.com. In **Project Settings → API** copy the Project URL, the `anon` key and the `service_role` key.
2. Run the migrations in `supabase/migrations/`, in filename order. Either paste each file into the **SQL editor**, or with the Supabase CLI: `supabase init`, `supabase link --project-ref <ref>`, `supabase db push`. The first file creates the tables, functions and RLS policies; the second seeds the library passages. That second file is generated from `src/lib/passages.ts`: after adding or editing a library passage, run `npm run seed:passages` and re-run the migration (it upserts).
3. **Authentication → Providers → Email**: leave Email enabled. "Confirm email" can stay on; the magic link does both.
4. **Authentication → URL Configuration**: set *Site URL* to the production URL (`https://<your-app>.vercel.app`) and add these *Redirect URLs*:
   - `https://<your-app>.vercel.app/auth/callback`
   - `http://localhost:3000/auth/callback`
5. Optional but recommended: **Authentication → Email Templates → Magic Link**. Replace the link with
   `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email`
   so the link also works when it is opened on a different device than the one that asked for it (the default link only works in the browser that requested it).
6. Sign in once from the app. The first sign-in creates the parent account; a database trigger then creates the profile and seeds the two readers, Stella (grade 5, starting level 3) and Penny (grade 3, starting level 2). The app's first-run screen asks for the PINs and interests.

Every parent account gets its own Stella and Penny, so a second test account is fully separate (that is what the RLS check relies on).

## Run locally

```bash
npm install
cp .env.example .env.local   # fill in the three Supabase values
npm run dev
```

Open http://localhost:3000. You'll be sent to `/login`; request a link, open it on this machine, and you land on the reader screen. The parent dashboard is at `/parent`.

Listening uses the browser's built-in speech recognition, so test in Chrome or Safari. Away from `localhost` the page must be served over https for the microphone to work.

## Test and build

```bash
npm test             # Vitest: scoring, leveling, week boundary, session planner, rate limit, row mapping,
                     #         and the RLS policies (real migrations run in an in-process Postgres)
npm run typecheck
npm run build        # production build; then scripts/check-bundle.mjs scans the client JS for secrets
```

### Acceptance checks for milestone 2

- **No secret in the client bundle.** `npm run build` runs `scripts/check-bundle.mjs` afterwards. It fails the build if `.next/static` contains `sk-ant`, a service-role claim, any server-only variable name, or the actual values of the server-only variables from `.env.local`. Only the two `NEXT_PUBLIC_` values reach the browser; `src/lib/supabase/admin.ts` imports `server-only`, so importing it from client code is a build error.
- **A second parent cannot read either girl's rows.** Automated: `src/lib/__tests__/rls.test.ts` runs the real migrations in PGlite, creates two parents and checks that each sees only her own readers, sessions, trouble words, baselines and reward weeks, that PIN hashes are unreadable, and that writes against the other parent's readers fail. Against the hosted project: `npm run rls:live -- <parent-email>` creates a throwaway second parent with the service role, signs in as it, tries to read and write the real parent's rows, prints PASS/FAIL per check, and deletes the throwaway user.
  Manual version: sign in on a second browser with a different email. The parent view shows that account's own empty Stella and Penny; the real account's sessions never appear. In the Supabase **Table editor** with the RLS-respecting "impersonate" option set to that user, `readers` and `sessions` show only that user's rows.
- **Same progress on two devices.** Sign in on the iPad and on a phone, have a girl finish a story on one, then open the parent view on the other: the session, stars and reward dots match. The app re-fetches whenever the tab comes back into view.

## Juno's voice (Azure neural TTS)

Out of the box Juno speaks with the device's built-in voice. To give her the same warm voice on every device:

1. In the Azure portal, create a **Speech** resource (the free F0 tier covers a family's reading easily). Open **Keys and Endpoint** and copy **Key 1** and the **Location/Region** (for example `westus2`).
2. Put them in `.env.local` for local runs and in the Vercel project's environment variables for production, then redeploy:

   ```
   AZURE_SPEECH_KEY=…
   AZURE_SPEECH_REGION=westus2
   AZURE_TTS_VOICE=en-US-AvaNeural
   ```

The key stays on the server. The browser calls `/api/tts`, which returns MP3 audio and a start time for each word (used by "Hear it first"), and caches each line in memory and on Vercel's CDN so repeats like "That's right!" are free. If Azure is unreachable, or the variables are unset, Juno falls back to the device voice for that line.

## Deploy to Vercel

1. In Vercel, **Add New Project** and import the GitHub repo. The Next.js defaults are correct.
2. Add the environment variables from `.env.example` (at least the three Supabase values, plus the Azure ones for Juno's voice) in the project settings.
3. Every push to `main` redeploys. Open the production URL on the iPad in Safari, sign in with the magic link, and allow the microphone on the first "Start reading" tap.

## Where things live

- `supabase/migrations/` – tables, RLS policies, helper functions, the signup trigger that seeds the readers, and the library passages (regenerate with `npm run seed:passages`)
- `src/proxy.ts` – refreshes the Supabase session on every request and sends signed-out visitors to `/login`
- `src/app/login`, `src/app/auth/*` – magic-link sign-in, callback, sign-out
- `src/app/api/verify-pin`, `src/app/api/pins`, `src/app/api/sessions` – PIN check (rate-limited), PIN set (hashing), session save (trouble words, level, reward week)
- `src/lib/supabase/` – browser client, cookie-bound server client, service-role admin client (server only)
- `src/lib/data.ts` – the browser's reads and writes; `src/hooks/useAppState.ts` – loads state and exposes the actions the screens call
- `src/lib/db/` – row types and the rows → app-state mapping
- `src/lib/sessionSave.ts` – pure rules behind `POST /api/sessions`; `src/lib/rateLimit.ts` – the 5-per-minute window
- `src/lib/passages.ts` – the library passages, level labels, grade benchmarks
- `src/lib/words.ts` – word matching and the lookahead alignment used while she reads
- `src/lib/scoring.ts` – accuracy, WCPM, stars, leveling, reading-check routing (all thresholds in `RULES`)
- `src/lib/time.ts` – Monday-to-Sunday reward weeks in America/Los_Angeles
- `src/lib/store.ts` – the client-side reader model and derived values
- `src/app/api/tts/route.ts`, `src/lib/azureTts.ts` – Juno's Azure voice and its server-side cache; `src/lib/ttsClient.ts` plays it in the browser
- `src/lib/ttsTiming.ts` – MP3 length and per-word start times for "Hear it first"
- `src/components/ReaderApp.tsx` – the reader state machine: login, home, read, word practice, quiz, results
- `src/components/parent/ParentDashboard.tsx` – the parent view

Grade labels appear only in the parent view. Reader screens never show them.
