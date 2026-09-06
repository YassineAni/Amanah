# Tasks — elderly-care-mvp (the care-signal loop)

Ordered so that stopping at the end of any group still leaves a coherent, demoable app. Rough solo budget in brackets. If behind at the group-7 checkpoint, cut group 9 (P1) first.

> **Build status (2026-09-06):** `[x]` here means *code written + `tsc --noEmit` clean + `npm run build` green + logic verified by `app/scripts/smoke.ts` (`npm run smoke`, all pass)*. It does **not** yet mean visually confirmed in a browser — the Chrome extension was not connected this session, so every "verify [visual/keyboard/zoom/screen-reader/device]" clause is still open. Live Whisper (3.2), device mic test (1.6), and group 8 (a11y verification) are genuinely not done. Next session: connect the browser, walk the demo script, then re-confirm the visual `[x]`s.

## 1. Project setup [~1h]

- [x] 1.1 Scaffold Vite + React + TypeScript; verify `npm run dev` serves a blank app with no console errors
- [x] 1.2 Add and configure Tailwind; verify a utility class renders and HMR works
- [x] 1.3 Add `vite-plugin-pwa` (precache only), a manifest, and a 512px icon; verify the build emits a service worker and the app is installable in Chrome
- [x] 1.4 Create folder structure (`store/`, `selectors/`, `lib/` for `transcribe` + `getPrayerTimes`, `components/`, `screens/`, `data/`); verify `tsc --noEmit` passes
- [x] 1.5 Add a persistent "demo — fictional data" marker to the app shell; verify it shows on every screen and is screen-reader readable
- [ ] 1.6 On the actual demo phone, over HTTPS or localhost (getUserMedia is refused on plain HTTP), test `navigator.mediaDevices.getUserMedia({audio:true})` and a short `MediaRecorder` capture; record whether it works, what mime type it produces (iOS Safari gives `audio/mp4`, not `webm` — do not hardcode a type), and confirm demo mode works with no mic at all

## 2. Store, types, seed [~1.5h]

- [x] 2.1 Define types: Person (role, `isFamily`), Shift (window, caregiverId|null, purpose, activityTags), Checkin (date, transcript, translation, audioRef, mood, visibility), the `Mood` and `CheckinVisibility` unions, PrayerTimes; verify `tsc --noEmit`
- [x] 2.2 Implement the in-memory store (Zustand or `useReducer` + context) with `viewer`, `view`, `demoMode`, `textSize`, `highContrast` UI state, initialised from `data/seed.ts`; verify the app reads the elder's name from the store
- [x] 2.3 Define `DEMO_DATE` and write `data/seed.ts`: elder; circle of ~6 (elder, coordinator, 2 family, 1 hired caregiver `isFamily:false`, 1 remote family/observer); a week of shifts dated around `DEMO_DATE` with activity tags, arranged so good days cluster on garden + one caregiver and hard days on the new aide; ~7 historical check-ins (mix of good/hard, at least one hard day with a `family`-only note mentioning a personal topic); `getPrayerTimes(DEMO_DATE)` hardcoded values; verify the app boots with this data visible
- [x] 2.4 Seed the pre-recorded utterance set for demo mode: 2–3 short audio files + their canned transcript/translation, keyed so `transcribe()` demo path can return them; verify each file plays in the browser

## 3. transcribe() seam [~1.5h]

- [x] 3.1 Implement `transcribe(audioBlob, spokenLang): Promise<{transcript, translation, audioRef}>` with a `demoMode` branch; verify the demo branch returns a seeded result with no network request (check the Network tab)
- [ ] 3.2 Implement the live branch: POST audio to Whisper for an in-language transcript, then produce the care-team translation; key from an env var; verify one real Arabic clip returns a plausible transcript + translation
- [x] 3.3 Add a visible `demoMode` toggle control (dev-styled, like the role switcher); verify toggling it switches which branch `transcribe()` uses

## 4. Accessible primitives [~1.5h]

- [x] 4.1 Build `Button`, `MoodOption` (large target, shape+label not colour, `aria-pressed`), `Toggle`, `Field` (label tied to input), `Dialog` (focus trap + restore, `Esc`); verify each is keyboard-operable with a visible focus ring
- [x] 4.2 Add elder-set text-size control (≥3 steps) and high-contrast toggle as store state via CSS variables; verify layout survives the largest size + 200% zoom with no clipping
- [x] 4.3 Greyscale-filter pass on the primitives; verify no state is conveyed by colour alone

## 5. The daily check-in — P0 spine [~3h]

- [x] 5.1 Build the elder home screen: large calm layout, one big check-in button reachable with no scroll at the largest text size, plus her day's schedule below; verify the button meets 44px and the target position
- [x] 5.2 Build the capture flow: tap → record audio (or, in demo mode, pick/advance a seeded utterance) → stop when done, no time limit; verify recording is not discarded by elapsed time
- [x] 5.3 On stop, call `transcribe()`, show a "writing it down…" state, then display the transcript and translation; verify both appear and the original remains accessible after translation is shown
- [x] 5.4 Add the mood pick (one `MoodOption` from the fixed set) and a visibility pick (default "family only", shown as default); verify exactly one mood is stored and no score is computed
- [x] 5.5 Save the check-in as a dated entry authored by the elder; a second same-day check-in appends without destroying the first; verify both are retrievable
- [x] 5.6 Build the elder's own check-in history view showing every entry in full with who can currently see it; verify visibility settings do not hide anything from the elder

## 6. The care signal — P0 differentiator [~3h]

- [x] 6.1 Implement `visibleCheckin(checkin, viewer)` → `'full' | 'mood' | 'none'` from the visibility setting and `isFamily`; verify with assertions covering all 4 visibilities × {elder, coordinator, family, hired caregiver, observer}
- [x] 6.2 Implement selectors (`checkinForShiftHeader`, `checkinsForFamilyView`, `weekStripData`) that map through `visibleCheckin`; verify components cannot get check-in display data except via selectors
- [x] 6.3 Build the week strip: CSS grid, columns = days, row 1 = mood marker (shape+label not colour), "no check-in" shown as missing not neutral; verify it renders the seeded week
- [x] 6.4 Align the schedule under the strip: row 2 = caregivers, row 3 = activity tags, same columns; verify a given day's mood, caregiver, and activities line up in one view
- [x] 6.5 Build the caregiver shift view: at the top, yesterday-context from `checkinForShiftHeader` — mood + excerpt if permitted, mood + neutral "note exists" if not; verify both cases with a permitted and a restricted caregiver
- [x] 6.6 Build the family/observer view: mood trend + transcript/audio for permitted days; verify a `family`-only note shows for family and is withheld (mood only) for the observer if the observer is not family
- [x] 6.7 Let the coordinator edit the schedule from the care-signal view — reassign a caregiver, move/retag an activity; verify the strip reflects the change for future days
- [x] 6.8 Verify the loop end to end: as elder record a check-in → as coordinator see it on the strip beside the schedule → make a schedule change in response → the change persists in the view

## 7. Consent beat — P0 [~1h]

- [x] 7.1 Let the elder change a check-in's visibility from her history view; verify only the elder sees this control and the change takes effect on the next read with no reload
- [x] 7.2 Verify the money-shot: elder sets tonight's check-in (which has a personal note) to "family only" → switch to the hired caregiver's shift view → mood shows, words are gone, a neutral "note exists" indication is present → switch to a family member → full note shows → switch to coordinator → mood dot still on the strip, words hidden
- [x] 7.3 Verify no placeholder leaks the hidden note's text, length, or identifying detail

## 8. Accessibility verification pass [~1h]

- [ ] 8.1 Keyboard-only walkthrough of the full demo path; verify every control reachable and operable, focus visible and sane
- [ ] 8.2 Screen-reader pass (VoiceOver/TalkBack) on the elder home + check-in flow; verify the check-in button, recording state, mood, and visibility are announced with role/name/state — record real observations for the pitch
- [ ] 8.3 Verify AA contrast on all text pairs and 44px targets on interactive elements
- [ ] 8.4 Verify no interaction is time-limited and no state is colour-only (greyscale pass)

## 9. P1 — cut buffer [~2h]

- [x] 9.1 Prayer-time collision flag: when the coordinator schedules/moves an activity within 30 min before a prayer for `DEMO_DATE`, show a flag naming the prayer and time before confirm; verify with an activity placed just before Dhuhr
- [ ] 9.2 Lightweight caregiver end-of-shift note that appears on the day alongside the elder's check-in; verify it shows in the family view subject to no extra consent (caregiver notes are circle-visible)
- [x] 9.3 Correlation callout: deterministic rule over the visible window (guard: needs at least 3 good days and 2 hard days before computing, to avoid divide-by-zero and noise) emits at most one observational, non-causal line; verify it fires for the seeded "garden = good days" pattern, does NOT fire an unintended pattern, and is absent when no attribute clears the threshold

## 10. Backend + frontend handoff (added — solo pivot to Replit for FE) [done]

- [x] 10a Build `server/` — Node + Express + TS, in-memory + JSON persistence, no native deps (Replit-safe); `tsc --noEmit` clean; manual curl suite passes (auth, server-side consent enforcement, role guards, the loop, prayer flag data, path-traversal guard, transcribe throttle)
- [x] 10b Move the OpenAI key server-side (`server/src/transcribe.ts`) — closes the client-key-exposure flaw; live branch proxied, demo branch offline
- [x] 10c Consent enforced on the server (`server/src/consent.ts` `serializeCheckin`) — the wire never carries a transcript the caller may not see (now a real boundary)
- [x] 10d Write `HANDOFF-FOR-REPLIT.md` — 4 personas, full endpoint reference, screen-by-screen control list, design system, build boundary
- [x] 10e Collapse personas 5 -> 4 (drop `observer`; `family` is many users, one read-only view) across app + server + docs

## 11. Demo readiness [~1h, protect this time]

- [ ] 10.1 Rehearse the 90-second script from `docs/demo-script.md` end to end twice; verify the full role sequence works with no dead ends
- [ ] 10.2 Verify accidental-reload recovery returns to a clean seeded state the script can restart from
- [ ] 10.3 Confirm `demoMode` default for the demo, with one early live-transcription moment on a good connection; verify every scripted utterance has a pre-recorded fallback
- [ ] 10.4 Build the production bundle, install the PWA on the demo phone, run the demo path on that install; verify no stale cache and fullscreen (no browser chrome)
- [ ] 10.5 Prepare the spoken real-vs-mocked lines (Whisper billed API + offline demo mode, seeded history, hardcoded prayer times, seeded users, rule-based callout not ML); verify they match what the app actually does
