## Context

Greenfield, one developer, ~14–16 productive hours inside 24 (MuslimHacks 2026, Challenge 01). Motivation is in `proposal.md`; requirements in `specs/`. Human-readable expansion in `docs/`.

The product is one loop: **elder speaks her day → it trends beside the schedule → the schedule changes in response.** Everything is in service of making that loop visible and real in a 90-second demo. The differentiator is not that feedback is collected — it is that the loop *closes* on screen.

Hard constraints:

- The demo must show the schedule changing *because of* what the elder said. If that beat is weak, the pitch is weak.
- The check-in must be completable by an 80-year-old in one action, by voice, in her language.
- No clinical logic, no mood scoring, no advice. "Was today good," never an assessment.
- Conference wifi is assumed hostile: an offline demo mode must produce a full check-in with no network call.

## Goals / Non-Goals

**Goals:**

- One in-memory store; one read-filter for check-in visibility; one `transcribe()` seam for Whisper.
- A single aligned view where the mood trend and the schedule are read together.
- A coordinator action that edits the schedule from inside that view.
- Voice capture that works on a phone browser and degrades to demo mode offline.

**Non-Goals (design-level, on top of the proposal CUT list):**

- No persistence. State resets on reload; acceptable, and a clean-slate recovery mid-demo.
- No real routing library — a small typed view-state switch covers ~5 screens.
- No component library — five hand-built accessible primitives.
- No charting library — the week strip is CSS grid, not a chart.
- No ML — the correlation callout is a deterministic rule over the visible window.

## Decisions

### D1: Vite + React + TypeScript + Tailwind

Fastest cold start for a solo web build; TS catches the mistyped role/visibility strings; Tailwind gives cheap focus states and no CSS-architecture decisions. Alternatives: Next.js (routing/SSR this does not need), vanilla TS (more view-wiring cost than it saves).

### D2: In-memory store seeded from a file, no persistence

Single module holds elder, circle, shifts, check-ins, consent, prayer times, UI state; initialised from `seed.ts`. Reset-on-reload is a demo feature. Alternatives rejected: localStorage (serialization bugs, stale-state mid-demo), any backend/DB (network dependency, cut auth).

### D3: `transcribe(audioBlob, spokenLang)` is the only path to Whisper

Returns `{ transcript, translation, audioRef }`. One call site. Two implementations chosen at runtime by a `demoMode` flag:

- **live**: POST the audio to Whisper (`whisper-1` / `gpt-4o-transcribe`) for an in-language transcript, then one translate call (or Whisper's translate mode) for the care-team rendering. The API key is read from an env var and, for a real deployment, proxied — for the hackathon a dev-time proxy or a scoped key is acceptable and is stated in the demo.
- **demo**: return a pre-recorded audio ref plus a canned transcript/translation for a fixed set of seeded utterances. No network.

The demo toggle is a visible dev control, like the role switcher.

### D4: One read-filter for check-in visibility

```
type CheckinVisibility = 'circle' | 'family' | 'coordinator' | 'mood-only'
visibleCheckin(c: Checkin, viewer: Person): 'full' | 'mood' | 'none'
```

Every surface that renders a check-in (caregiver shift header, family view, coordinator strip) goes through a selector that calls this. Components never read `store.checkins` directly for display. `mood-only` and any denied `full` still let the mood dot render on the strip — the trend is never broken by a privacy choice. The elder's own views bypass the filter (she always sees everything she said). This is the one function worth a handful of assertions.

### D5: The care-signal view is one CSS-grid alignment, not a chart

Columns = days in the window. Row 1 = mood marker (shape + label, not colour alone). Row 2 = that day's shifts/caregivers. Row 3 = activity tags. The coordinator edits row 2/3 in place. Building this as a grid rather than a charting library keeps it small, accessible, and themeable, and makes "move the garden visit" a direct cell edit.

### D6: Role switcher instead of auth

A visually distinct control sets the acting person; changing it re-renders from that role's entry screen. Roles: elder (records + controls consent), coordinator (care-signal view + schedule edits), caregiver (own shift + permitted yesterday-context), family/observer (trend + permitted words). Demo-only — must never reach a real deployment.

### D7: Correlation callout is a deterministic rule

Over the visible window: for each schedule attribute (activity tag, assigned caregiver), compare its rate on good days vs hard days. If one attribute appears in a clear majority of good days and a clear minority of hard days (fixed thresholds), emit one plain-language observation. No attribute clears the bar → no callout. Never asserts causation, never recommends. This is honest to demo as "a simple rule, not AI".

### D8: `getPrayerTimes(date)` hardcoded against a `DEMO_DATE` constant

Not `new Date()` — hackathons run past midnight. Seed shifts/activities are dated to `DEMO_DATE`. The collision check (activity within 30 min before a prayer) consumes only this function's output. A real source (e.g. `adhan`) drops in behind the same signature.

### D9: Accessibility built into the primitives from the start

Five primitives (`Button`, `MoodOption`, `Toggle`, `Field`, `Dialog`) built accessible once: real `<button>`s, labels tied to inputs, focus management in the dialog, visible focus rings, `aria-pressed` where relevant, never colour-alone state. Elder-set text-size and high-contrast are store state from the first commit. The elder surface is voice-first by design, which is itself the headline accessibility decision.

## Risks / Trade-offs

- **The "schedule changes because of her" beat lands flat.** → Storyboard it first (`docs/demo-script.md`): the seeded week is arranged so the correlation is unambiguous (good days = garden + Amina; hard days = the new aide), so the coordinator's edit is obvious and satisfying. Rehearse twice on a phone.
- **Whisper latency or failure on stage.** → `demoMode` on by default for the demo; live mode is shown once early on a good connection, then toggled off. Pre-recorded utterances cover every line in the script.
- **A component bypasses `visibleCheckin` and leaks a family-only note.** → Only selectors expose check-ins to components; raw collection not exported for display. Assertions cover the truth table. Manual: run the consent beat from the script twice.
- **Mood scoring creep** (someone adds a 1–5 scale, an average, a trend number). → Spec forbids it; the strip shows discrete labelled markers and "no check-in" gaps, never an average.
- **Reset-on-reload bites mid-demo.** → Script never depends on state surviving reload; reload is the recovery move.
- **PWA service worker serves stale code.** → Precache only, bump per build, hard-reload before demoing.
- **Solo scope overrun.** → `tasks.md` ordered so stopping at any group leaves a coherent demo; P1 (prayer flag, caregiver shift-note, correlation callout) is the cut buffer.
- **Voice recording permissions / browser quirks on the demo phone.** → Test `getUserMedia` on the actual demo device early (task group 1); demo mode does not need the mic at all, so it is the hard fallback.

## Migration Plan

Not applicable (greenfield, no users). Post-hackathon seams that matter: `transcribe()` (swap proxy/model), the store module (persistence adapter behind the selector API), `getPrayerTimes()` (real source), the role switcher (real auth feeding the same `viewer`).

## Open Questions

- **Zustand vs. `useReducer` + context** — decide in hour one; both satisfy the selector API.
- **Whisper translate mode vs. a separate translate call** — decide when wiring `transcribe()` live; demo mode is unaffected.
- **High-contrast as a full theme vs. CSS-variable overrides** — either meets the requirement; defer to the accessibility task.
