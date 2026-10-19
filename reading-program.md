# Connolly Reading Coach: Build Spec

A web app that coaches two sisters with their reading:

- **Stella Connolly**, 5th grade, reading well below grade level
- **Penny Connolly**, 3rd grade

Each girl has her own login, level, progress, tricky words and weekly reward.

For each reader, A talking coach ("Coach Juno") asks her to read stories out loud, listens as she reads, helps when she gets stuck, practices missed words, checks comprehension, adjusts difficulty, and tracks a weekly goal tied to a $5 reward. A parent dashboard shows progress.

**Starting point:** `index.html` (version 1) in this repo is a working single-file prototype that uses the browser's built-in speech APIs and localStorage. Reuse its passages, flows, copy, leveling rules and visual design. This build moves it to a real stack with server-side keys, accurate speech scoring, logins and synced data.

Build one milestone at a time, in order. Stop after each milestone so it can be tested with both girls.

---

## 1. Users

| User | How they sign in | What they see |
|---|---|---|
| Parent (Rob) | Email magic link (Supabase Auth) | Parent dashboard, settings, reward tracking |
| Reader (Stella or Penny) | On a device where the parent is signed in, tap her profile and enter a 4-digit PIN | Coach, stories, word practice, quiz, weekly goal |

- One parent account has two reader profiles: Stella (grade 5) and Penny (grade 3). The login screen shows both name tiles, and each girl has her own PIN.
- Nothing is shared between readers: each has her own level, sessions, trouble words, weekly goal and reward.
- The reader PIN is checked server-side and stored hashed. It is a convenience lock, not real security.
- The parent dashboard also needs its own 4-digit PIN, so the girls can't open it on a shared device.

## 2. Stack

- **Next.js (App Router) + TypeScript**, deployed on **Vercel** from this GitHub repo.
- **Supabase** for auth and Postgres, with Row Level Security (RLS) on every table.
- **Azure AI Speech**:
  - Pronunciation Assessment scores her reading against the story text.
  - Neural text-to-speech gives Juno her voice.
- **Anthropic API** writes new stories and short coaching notes.
- **Brevo** (optional) texts or emails the parent when the weekly goal is hit.
- Styling: keep version 1's tokens, fonts (Lexend for reading text, Bricolage Grotesque for headings), light and dark themes, and large reading type.

## 3. Environment variables

Store these in Vercel project settings. Never expose any of them to the browser except the two marked public.

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=        # server only
ANTHROPIC_API_KEY=                # server only
ANTHROPIC_MODEL=claude-sonnet-5-5
AZURE_SPEECH_KEY=                 # server only
AZURE_SPEECH_REGION=              # e.g. westus2
AZURE_TTS_VOICE=en-US-AvaNeural   # pick a warm, young-sounding voice
BREVO_API_KEY=                    # optional, server only
PARENT_NOTIFY_PHONE=              # optional
PARENT_NOTIFY_EMAIL=              # optional
```

## 4. Server routes

| Route | Purpose |
|---|---|
| `POST /api/speech-token` | Exchanges `AZURE_SPEECH_KEY` for a short-lived Azure auth token (`https://{region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`) and returns `{token, region}`. The browser Speech SDK uses this token, so the key never reaches the client. Requires a signed-in parent session. |
| `POST /api/tts` | Takes `{text, rate}` and returns MP3 audio from Azure neural TTS. Cache by text hash in Supabase Storage so repeated lines ("That's right!") are free. |
| `POST /api/story` | Takes `{readerId, level}`. Calls Anthropic to write a leveled story with 3 questions (prompt in §9), validates the JSON, saves it to `passages`, and returns it. |
| `POST /api/coach-note` | Takes a session summary and returns 2 spoken sentences of praise plus one tip (prompt in §9). |
| `POST /api/verify-pin` | Takes `{readerId or "parent", pin}` and checks it against the bcrypt hash. Rate-limit to 5 tries per minute. |
| `POST /api/sessions` | Saves a finished reading session, updates trouble words, recomputes the level, checks the weekly goal, and fires the Brevo notification on the first crossing. |

## 5. Data model (Supabase)

```sql
profiles (id uuid pk = auth.users.id, parent_pin_hash text, created_at)
readers  (id uuid pk, parent_id uuid fk profiles, name text, pin_hash text,
          grade int, interests text, level int default 3 check (level between 1 and 7),
          weekly_goal int default 5, weekly_reward_cents int default 500,
          created_at)
passages (id text pk, level int, title text, text text, questions jsonb,
          source text check (source in ('library','ai')), reader_id uuid null, created_at)
sessions (id uuid pk, reader_id uuid fk, passage_id text fk, mode text  -- 'check' | 'practice'
          , started_at, ended_at, words_total int, words_attempted int,
          words_correct int, accuracy numeric, wcpm int, comp_right int, comp_total int,
          helped_words text[], missed_words text[], azure_scores jsonb,
          counts_for_goal bool, stars int)
trouble_words (reader_id uuid, word text, misses int, wins int, last_seen timestamptz,
               primary key (reader_id, word))
baselines (id uuid pk, reader_id uuid, date timestamptz, level int, wcpm int, passage_ids text[])
reward_weeks (reader_id uuid, week_start date, stories int, earned bool,
              paid_at timestamptz null, notified_at timestamptz null,
              primary key (reader_id, week_start))
```

- RLS: a parent can read and write only rows that belong to their own readers.
- Seed `readers` with Stella (grade 5, level 3) and Penny (grade 3, level 2) under the parent's account. PINs and interests are set in the parent dashboard on first run.
- Seed `passages` from the 14 library passages in `index.html`: levels 1–7, two per level, with ids such as `3a`.

## 6. Core flows

### 6.1 Reading a story (the heart of the app)

1. Show the story in large Lexend type, one `<span>` per word.
2. **Practice mode only:** a "Hear it first" button plays Juno reading the story while each word highlights in turn. Use Azure TTS word-boundary events, or estimate word timings if those aren't available.
3. "Start reading" opens the microphone using the Azure Speech SDK (`microsoft-cognitiveservices-speech-sdk`) in continuous recognition mode, with `PronunciationAssessmentConfig` set as follows:
   - reference text = the story
   - grading = HundredMark
   - granularity = Word
   - miscue detection = on
4. **Live feedback:** on each recognized segment, map Azure's word results onto the story words.
   - Correct words turn green.
   - Use a lookahead alignment like version 1's `advance()`, and treat short function words the recognizer drops as read.
   - Keep version 1's browser-recognition alignment as a fallback when Azure is unreachable.
5. **Stall help:** if she hasn't advanced in 5.5 seconds, pause the mic and have Juno say "That word is ___." Mark the word as *helped* (counted as an error, as in a standard oral reading fluency test), then resume the mic. Before her first word, nudge once after 10 seconds.
6. **Finish:** the session ends when she reaches the last word or taps "I'm done." Compute:
   - `accuracy = correct / attempted`, where skipped and helped words are errors
   - `wcpm = correct / minutes from first to last word`
   - the list of missed words
   - Azure's accuracy, fluency and completeness scores, saved in `azure_scores`
7. If she read less than 50% of the story, give encouragement and return home without saving a counted session.

### 6.2 Word practice (practice mode, after reading)

For up to 5 missed words, one at a time:

1. Show the word huge. Juno says "This word is ___," then says it slowly.
2. "Your turn": run a single-utterance Pronunciation Assessment on that word. It passes if the word accuracy score is at least 70 (tune this).
3. If she misses, Juno says it again and she gets one retry. If she misses again: "We'll come back to it."
4. Update `trouble_words`: `misses++` when the word is missed while reading, `wins++` when she passes in practice. A word is "tricky" while `misses > wins`.

### 6.3 Comprehension quiz

- Ask 3 multiple-choice questions with shuffled options. Juno reads each question and its options aloud, and she taps an answer.
- Spoken feedback for a right answer: "That's right!" For a wrong answer: "Good try. The answer is ___."

### 6.4 Reading check (baseline)

1. Start well below her school grade: level 3 for Stella and level 2 for Penny. Store the starting level on the reader so it can be changed. A level is **passed** when accuracy is at least 93% and she gets at least 2 of 3 questions right.
2. If she passes, test the next level up; if she fails, test the next level down. Stop when the next level was already tested, she reaches level 1 or 7, or 5 stories are done.
3. Her level is the highest level passed (1 if none).
4. Skip word practice during the check.
5. **Never say a grade level to either girl.** Say "Now I know which stories are just right for you." Grade labels appear only in the parent view.

### 6.5 Leveling after practice stories

- Level up (maximum 7) when accuracy is at least 97% and she gets all questions right.
- Level down (minimum 1) when accuracy is below 88% or she gets 1 or fewer questions right.
- Otherwise the level stays the same.
- **Stretch goal:** require 2 consecutive qualifying sessions before changing level, to avoid bouncing.

### 6.6 Picking the next story

1. Choose the least-read passage at her level.
2. Rereading is good for fluency. Once every passage at her level has been read at least twice, generate a new one with `/api/story` using her interests.

### 6.7 Weekly goal and $5 reward

- The week runs Monday 00:00 to Sunday 23:59 in the parent's time zone (America/Los_Angeles).
- A session **counts** toward the goal if she read at least 80% of the story and finished the quiz.
- Reader home screen:
  - a dollar bill graphic that fills in when the goal is earned
  - numbered dots, one per story in the goal, filled as she completes them
  - Juno's line: "N more stories this week to earn 5 dollars."
- On the session that crosses the goal, Juno says "You hit your weekly goal! You earned 5 dollars!" and the app sends the optional Brevo text or email to the parent, once per week.
- Parent view lists each earned and unpaid week, with a **Mark as paid** button.
- Star rewards per session: 1 for finishing, +1 for accuracy of at least 93%, +1 for all questions right.

### 6.8 Parent dashboard

- **Reward card:** this week's progress, amount owed, and the "Mark as paid" button.
- **Reading level:** shown as a grade label (map below) with the baseline date. Include a "Re-run reading check" button.
- **Reader switcher:** a toggle at the top switches between Stella and Penny. Add a side-by-side summary card showing both girls' weekly goal progress.
- **Latest words per minute:** with a reference line for her own grade's fall average and her baseline. Benchmarks (fall averages, approximate): grade 3 ≈ 83 WCPM, grade 5 ≈ 110 WCPM. Store these in a grade-keyed table so they are easy to edit.
- **Accuracy:** average of the last 5 sessions, with a target of 95% or higher.
- **Day streak.**
- **WCPM trend chart.**
- **Trouble words:** shown as chips with miss counts.
- **Session table:** date, story, level, WCPM, accuracy, questions right, words helped.
- **Settings:** weekly goal, reward amount, interests, manual level override, reader PIN reset, parent PIN.
- **Weekly email summary** (stretch goal).

Level-to-grade map:

| Level | Grade label |
|---|---|
| 1 | Grade 1 |
| 2 | Grade 2 |
| 3 | Grade 2–3 |
| 4 | Grade 3 |
| 5 | Grade 3–4 |
| 6 | Grade 4 |
| 7 | Grade 5 |

Target words per AI story by level: 60, 80, 100, 120, 130, 140, 150.

## 7. Coach voice and tone

- Warm, upbeat and brief. Every line is under about 20 words.
- Praise effort and specific wins. Never shame, and never mention grade levels to her.
- Show the coach's words in a speech bubble as well as speaking them, so it still works muted.
- Include a voice on/off toggle.
- The face animates while speaking and shows a green ring while listening.

## 8. Device and browser requirements

- Must work on an iPad (Safari) and a laptop (Chrome), and must be served over https.
- Ask for microphone permission on the first "Start reading" tap. If it is denied, show: "Ask a grown-up to allow the microphone for this page."
- All audio starts from a user tap, because iOS blocks autoplay.
- Layout works down to 400px wide. Reading text is 28px or larger on tablets.

## 9. Prompts

**Story (`/api/story`)**

Fill `{SCHOOL_GRADE}` with the reader's school grade ("5th grade" or "3rd grade") and `{AGE}` with her approximate age (about 10 for grade 5, about 8 for grade 3). `{GRADE}` is the grade label for her current reading level.

> Write an original reading passage for a {AGE} year old girl in {SCHOOL_GRADE} who reads at about a {GRADE} level. Base the topic on one of her interests: {INTERESTS}. Length: about {WORDS} words. Use vocabulary and sentence length right for {GRADE}, but make the subject feel grown-up enough that a {SCHOOL_GRADE} student won't think it's babyish. Write every number as words, never digits. Then write 3 multiple-choice comprehension questions (two about facts in the passage, one about a word meaning or an inference), each with 4 short options, correct option FIRST. Return only JSON: {"title":"...","text":"...","questions":[{"q":"...","options":["correct","wrong","wrong","wrong"]}]}

Validation and storage:
- Validate the JSON with zod. Reject output that contains digits or falls outside 70–130% of the target length, and retry once.
- Store `a: 0` as the correct answer, and shuffle the options at display time.

**Coach note (`/api/coach-note`)**

> You are Coach Juno, a warm, upbeat reading coach talking out loud to {NAME}, a {SCHOOL_GRADE} student building her reading skills. She just read "{TITLE}". Results: {ACC}% of words correct, {WCPM} words per minute, {RIGHT} of {TOTAL} questions right. Words she missed: {MISSED}. Write exactly two short spoken sentences: one specific piece of praise, and one simple tip for next time. Never mention grade levels. No emojis.

## 10. Milestones

Build in this order. After each one, deploy to Vercel and test with Stella and Penny.

1. **Port to Next.js on Vercel.**
   - Recreate version 1's screens and flows, still using browser speech and localStorage.
   - Done when the deployed https URL works on her iPad.
2. **Supabase.**
   - Add parent magic-link login, the reader profile with PIN, and the parent PIN.
   - Add all tables and RLS, and seed the passages.
   - Save sessions, trouble words and reward weeks to the database.
   - Done when each girl's progress shows the same on the iPad and on the parent's phone, and neither can see the other's data.
3. **Azure Pronunciation Assessment** for reading and word practice, using the token route.
   - Keep the browser-recognition fallback.
   - Done when skipped and misread words are flagged noticeably better than in version 1 on a test read.
4. **Azure neural TTS** for Juno's voice, with caching and word highlighting in "Hear it first."
5. **Anthropic** routes for new stories and coach notes, with the parent's interests used in stories.
6. **Reward polish.**
   - Brevo goal notification.
   - Paid-week history.
   - Optional weekly parent email summary.

## 11. Acceptance checks

- No API key appears in client bundles. Check the built JS for `sk-ant` and the Azure key.
- RLS blocks a second test parent account from reading either girl's rows.
- Accuracy, WCPM, leveling, reading-check routing and weekly-goal counting have unit tests (Vitest), including the week boundary on Sunday night Pacific time.
- A full session (read, then words, then quiz, then results) works on iPad Safari with the voice on.
- Grade levels never appear on any reader-facing screen.
- Stella's and Penny's sessions, levels, trouble words and rewards never mix. Test this with a session from each.
