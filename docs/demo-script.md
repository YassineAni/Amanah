# Demo script

~90 seconds. Five beats. The whole build serves **beat 2**: the coordinator
changes the schedule *because of what she said*. If only one beat lands, that one.

Matches the built system: 4 route-apps (`/`, `/coordinator`, `/caregiver`,
`/family`), the `server/` backend, **live Whisper transcription by default**,
button names from `../HANDOFF-FOR-REPLIT.md`.

**Setup:** open the 4 routes in **4 browser tabs** — Elder `/`, Coordinator
`/coordinator`, Caregiver `/caregiver?who=lea`, Family `/family`. Each is already
signed in as its person; there's no switcher. "Switching persona" = switching
tab. Backend running with `OPENAI_API_KEY` set. `POST /api/demo/reset` right
before you start.

Storyboard depends on the seed (`data-model.md`): good days = garden + Amina,
hard days = Léa (agency) with no garden, today has no check-in yet.

---

## Setup line — say while it loads

> "Elder care measures what goes *wrong* — falls, missed pills. Nobody measures
> whether she actually had a *good day*. This does — in her own voice — and it
> lets that steer her care. Everything on screen is fictional."

---

## Beat 1 — Fatima tells you about her day  (0:00–0:30)  · Elder tab `/`

**Do**
- On **Her Day**, tap **"Tell me about today"**.
- Tap **"Hold to talk"** and speak one line of Arabic (or hold for a scripted
  speaker). Release. Real recording → real Whisper.
- On the review screen: her Arabic words appear, the English underneath, a
  **▶ play**. Tap the **Good** face. Leave **"Just my family"** selected.
- Picking the face saves it. You land back on **Her Day**.

**Say**
> "Every evening she speaks — in her language, twenty seconds. It's transcribed
> and translated for the care team, live. She keeps her own recording. She
> chooses who sees it — right now, just her family."

**On screen** — brief "Thank you. Your family will see this." then Her Day.

**If the network chokes:** this tab was opened with `?demo=1` as a spare, or add
it and reload — the talk button then returns a seeded clip. Same line, no
network. Don't debug on stage.

---

## Beat 2 — Yusuf reschedules because of it  (0:30–1:05)  · Coordinator tab — THE BEAT

**Do**
- Switch to the **`/coordinator`** tab. Read **the read** at the top, then the
  **mood ribbon**, then the **Suggested moves** cards.
- Tap **one suggested move** — e.g. on *"Léa covers Thursday, with no garden…"*
  tap **"Give it to Amina"**. Then tap **"Add garden"** on another card.
- The read and the ribbon **recompute in place**; the cards you actioned clear.

**Say**
> "Here's her week — four good days, two hard. The app reads it back:" *(read the
> callout)* "*three of her four good days included time in the garden.* Her hard
> days are agency shifts, no time outside. So it suggests: put Amina on Thursday,
> add a garden visit here." *(after the taps)* "**She told us how her days felt,
> and next week changed because of it.** That's the whole product — the loop
> closes."

**On screen** — callout: *"3 of her 4 good days this week included time in the
garden. (a co-occurrence, not a cause)"*. After the taps the ribbon's upcoming
cells show Amina + garden; the actioned cards are gone.

**Leave** — Léa must keep **one** upcoming shift so beat 3 works. Don't clear
every card.

---

## Beat 3 — Léa starts a shift half-informed  (1:05–1:20)  · Caregiver tab `/caregiver?who=lea`

**Do** — switch to the **`/caregiver?who=lea`** tab. Read the **"Before you
start"** card.

**Say**
> "Léa is agency, not family. Before her shift she sees Fatima's mood from
> tonight's check-in — good — and that there's a note. Not the words. She isn't
> in the family's running history, and the app holds that line."

**On screen** — "Before you start": a **good** marker + *"She left a note. It
isn't shared with you."* Below, her one remaining shift. Footer: *"As agency
staff, family history isn't shown to you."*

**Note** — the marker is **good** because beat 1 saved tonight's check-in; if you
skipped beat 1 it shows yesterday's **hard**. Either way the words are withheld —
that's the point.

---

## Beat 4 — Mona finally knows  (1:20–1:30)  · Family tab `/family`

**Do** — switch to the **`/family`** tab. The mini-trend, then tonight's card.

**Say**
> "Her daughter, three provinces away. The trend, and Fatima's own words from
> tonight — Arabic, the translation, the recording. The first time she can tell
> how her mother is without a phone call where her mother says 'fine'."

**On screen** — tonight's card: **good** marker, the Arabic, the English, a play
control.

---

## Beat 5 — she takes the words back  (1:30–1:40)  · Elder tab → Family tab

**Do**
- Back to the **`/`** tab → **"What I've shared"**. Find the **hard** day
  (*"…kept thinking about my sister"*). Under **"Who can see this"**, tap
  **"Just my mood, not my words"**.
- Switch to the **`/family`** tab, reload, look at that same day.

**Say**
> "She recorded that. She can take the words back and keep the signal. Her
> family still sees it was a hard day — they don't get the sentence about her
> sister unless she wants them to. She owns it, and she can change her mind
> after the fact. And that's enforced on the server — the hidden words never
> reach her daughter's browser."

**On screen** — in the Family tab that day flips from full text to *"She kept
this note private. Her mood still shows."* The **hard** marker stays on the
trend.

---

## Say out loud (real vs mocked)

- "Transcription is the **real OpenAI Whisper API** — that recording just went to
  the server and came back. `?demo=1` is a spare tab with pre-recorded clips in
  case the venue wifi dies."
- "The week of history is seeded. Tonight's check-in was live."
- "The garden line is a **rule** — good-day rate vs hard-day rate per activity,
  guarded for small samples — not machine learning. It says they *co-occur*,
  never that the garden *caused* anything."
- "Consent is enforced **on the server**. A note she's hidden never reaches the
  other person's browser — not just hidden in the UI."
- "Login is auto — one URL per person. Real auth is roadmap."
- "No mood scores, no clinical scales, no advice. It records 'was today good' and
  puts it in front of the people who arrange her care."

---

## The brief's three questions

- **Primary user?** The elder — she generates the signal. The coordinator,
  caregiver, and remote family are the three audiences that act on it.
- **Better than the family WhatsApp group?** In the group, her children talk
  *about* her. Here she talks — in her language, once a day, twenty seconds — and
  the schedule responds. And she sets who reads each entry.
- **Who accesses the data, who controls it?** Each check-in's words are visible
  per the level she chose; the mood always trends. She sets it, changes it after
  the fact, always sees her own account in full. Enforced server-side.

---

## Failure drills

- **Accidental reload / messy state:** `Ctrl+Shift+R` (→ `POST /api/demo/reset` +
  reload) or `curl` it. Restart from beat 1. Five seconds — practise it calm.
- **Live transcription fails in beat 1:** add `?demo=1` to the Elder tab, reload,
  tap talk — it returns the seeded clip. Carry on.
- **Wifi dies entirely:** every tab still talks to the local server; only beat 1
  needs the internet. Put `?demo=1` on the Elder tab and the whole demo is
  offline.
- **Running long:** cut **beat 4** (Family). Never cut **beat 2** (the loop) or
  **beat 5** (consent).
- **No suggested-move cards on the coordinator tab:** the seed pattern didn't
  clear the guard (need ≥3 good, ≥2 hard days) — you're looking before beat 1
  saved, or `data.json` drifted. Reset and retry.
- **Callout reads "3 of her 3" not "3 of her 4":** you're looking before beat 1
  saved. Fine — it updates.

---

## Pre-demo checklist

- [ ] Record 3 real Arabic clips (texts in `server/src/seed.ts` → `utterances`)
      into `server/audio/u1.wav u2.wav u3.wav` (1-second silence right now).
- [ ] Native Arabic speaker checks the seed transcripts / translations.
- [x] `OPENAI_API_KEY` is in `server/.env` and live Whisper is verified end to
      end (server → OpenAI → transcript). For Replit: put it in Secrets + set
      `CORS_ORIGIN`. Confirm the spending cap. **Rotate the key after the event.**
- [ ] `cd server && npm install && npm run dev`, `curl .../api/health`.
- [ ] Point the frontend `API_BASE` at the server. Open all 4 routes — each lands
      on the right app, signed in, no login screen.
- [ ] One real live Whisper round-trip from the Elder tab, **in Arabic** — the
      English `translation` should come back too (translation only runs for
      non-English input; the machine test above was English so it skipped it).
- [ ] Mic test on the actual demo device, **over HTTPS or localhost**
      (`getUserMedia` is refused on plain HTTP); note the mime (iOS = `audio/mp4`).
- [ ] Coordinator tab shows a callout and at least one suggested-move card.
- [ ] Keyboard-only pass through all 5 beats; one screen-reader pass on the Elder
      check-in — note what you actually hear.
- [ ] Walk the full script twice.
- [ ] `Ctrl+Shift+R` (reset) immediately before going on stage.
