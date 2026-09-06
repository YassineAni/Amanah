## Why

Elder care is measured by what goes wrong: no falls, no missed medications, no hospital visits. A week with none of that counts as a good week — regardless of how the elder actually lived it. Boredom, loneliness, the grind of being handled by rotating strangers produce no report, so they never enter the record and nothing responds to them. The one person who knows whether today was good — the elder — is asked "how are you?" at the door, says "fine," and it goes nowhere, because there is no structure to catch it, trend it, or loop it back into how care is arranged.

This change builds the missing loop. The elder gives a short spoken account of her day, every evening, in her own language. It trends, it sits beside the schedule, and the people who arrange her care schedule *toward her good days*. Her felt experience becomes the steering input instead of a footnote. It is a 24-hour solo hackathon build (MuslimHacks 2026, Challenge 01); the plan below is scoped to one person.

## What Changes

- **New Vite + React + TypeScript web app**, installable as a PWA, mobile-first. No backend, no database, no auth — an in-memory store seeded from a file, with a role switcher standing in for login.
- **The daily check-in (P0, the spine)**: each evening the elder taps one large button and speaks for ~20 seconds — "how was today, really?". Whisper transcribes it in her language and keeps the original audio; a caregiver-facing translation sits beside it. She picks one mood face. The result is a dated check-in entry.
- **The care signal (P0, the differentiator)**: check-ins trend on a week strip. The strip is placed **next to the schedule** — caregivers, activities, time outside — so the pattern is legible: what lines up with her good days and her hard ones. The coordinator can act on it (move activities, reassign shifts). A caregiver opening a shift sees a one-line "yesterday was hard for her — she mentioned missing her sister" so they start informed. Remote family sees the trend and her own words: the answer to "is she okay?".
- **Consent over her own account (P0)**: each check-in note carries a visibility the elder controls — everyone in the circle / family only / coordinator only / mood-only. Set a note to family-only and the coordinator sees the mood dot but not the words. She owns what is said about her because she is the one saying it.
- **The schedule (P0, supporting)**: shifts with an assigned caregiver, what each is for, and simple activity tags (garden, outing, physio, companionship). This is the substrate the signal correlates against — not a full coordinator kanban.
- **Cultural context surfaces through her words, not a settings sheet (P0 touch)**: a check-in note like "it was hard, it's Ramadan and the afternoon outing wore me out" puts the cultural reality into the record in her own voice. One cheap structured touch is kept: a prayer-time collision flag when an activity is scheduled within 30 minutes before a prayer.
- **Offline demo mode (P0)**: pre-recorded elder utterances play through the same Whisper pipeline path (or a cached transcript) when there is no network. Conference wifi is assumed hostile.
- **Accessibility as the core axis (P0)**: the elder's surface is voice-first by design; plus semantic HTML, keyboard reach, AA contrast, 44px targets, 200% text-scale survival, an elder-set text-size control, high-contrast mode, no time-limited interactions, no colour-only state. One screen tested with a screen reader.
- **CUT**: structured multi-chip caregiver handoff, the preference sheet as a full surface, the coordinator kanban board, file upload and attachments, timeline view, assistant, contact escalation, caregiver marketplace/matching, Arabic/RTL full flip, native app, push notifications, any clinical logic or scoring.

### Scope triage (MoSCoW, solo, ~14–16 productive hours)

| Tier | Items |
|---|---|
| **P0 — must** | In-memory store + seed; the daily check-in with Whisper transcribe/translate + audio kept; mood pick; the week strip beside the schedule; coordinator can reschedule/reassign from it; caregiver sees "yesterday" context; family sees the trend; consent on check-in notes; role switcher; offline demo mode; accessibility basics; PWA manifest + service worker |
| **P1 — should, if ahead** | Prayer-time collision flag; a lightweight caregiver end-of-shift note that also feeds the day; a simple correlation callout ("3 of 4 good days included time outside") |
| **CUT — will not** | Structured handoff, preference sheet surface, kanban board, upload, timeline, assistant, escalation, matching, RTL flip, native, real auth, notifications, any scoring or advice |

### Real vs. mocked (say this out loud in the demo)

| Built for real | Mocked / seeded / roadmap |
|---|---|
| Daily check-in: record → Whisper transcribe + translate → entry | Whisper billed API; offline demo mode uses pre-recorded audio / cached transcripts |
| Week strip trending real check-in data | Historical check-ins are seeded |
| Coordinator rescheduling from the strip | — |
| Consent hiding the note while keeping the mood | — |
| Correlation callout (P1) | Computed by a simple rule over seeded + live data, not ML — say so |
| Prayer-time collision flag (P1) | Prayer times hardcoded for the demo date behind a `getPrayerTimes()` seam |
| Auth | Seeded users + role switcher |

## Capabilities

### New Capabilities

- `daily-checkin`: the elder's short spoken account of her day — one-button capture, Whisper transcription in her language with the original audio retained, a caregiver-facing translation, one mood value, producing a dated check-in entry. Includes offline demo mode.
- `care-signal`: what the check-ins do — trend on a week strip placed beside the schedule of shifts and activities, surface a one-line "yesterday" context to a caregiver starting a shift, present the trend and the elder's words to remote family, and let the coordinator change the schedule in response. Includes the schedule substrate (shifts, assignments, activity tags) and the optional correlation callout.
- `consent`: the elder controls the visibility of each check-in note — circle / family only / coordinator only / mood-only — enforced through one read-filter so a hidden note never leaks while its mood dot still shows.

### Modified Capabilities

None — greenfield project, no existing specs.

## Impact

- **New code**: entire application. Vite + React + TS + Tailwind; Zustand (or React context) for the in-memory store; `vite-plugin-pwa` for manifest and service worker. One server-side concern only: the Whisper API call — routed so the key is not shipped in the client bundle for a real deployment, but for the hackathon a dev proxy or direct call with a scoped key is acceptable and stated as such.
- **External dependency**: OpenAI Whisper (`whisper-1` / `gpt-4o-transcribe`) for transcription and translation. Behind a `transcribe(audio, lang)` seam. Offline demo mode bypasses it entirely. Two constraints this creates: (1) a Vite client bundles `VITE_*` env vars, so a live-mode build ships the API key to the browser — mitigated by a hard spending cap, no public deploy of the live build, and key deletion after the event; (2) sending elder speech to a US processor is a cross-border transfer of sensitive personal information that Quebec Law 25 would gate behind a privacy impact assessment — a roadmap concern (Canadian/on-prem transcription), not a demo blocker with fictional data.
- **Data**: one seed file — elder, a small circle (elder, coordinator, two family, one hired caregiver, one remote family/observer), a week of shifts with activity tags, ~7 historical check-ins (a mix of good and hard days, at least one hard day carrying a family-only note), default consent, hardcoded prayer times for the demo date. No persistence — state resets on reload, acceptable and a clean-slate recovery during a live demo.
- **Out of scope / non-goals**: no diagnoses, dosages, vitals, triage, or mood *scoring* (no PHQ-9, no clinical scales); the check-in is "was today good," never an assessment. Not a medical device and not a substitute for professional care assessment. Real elder data would fall under Quebec Law 25 (sensitive personal information, plus voice recordings) with consent, retention, and access-log obligations this demo does not implement. All demo data is fictional and the running app carries a visible "demo — fictional data" marker.
