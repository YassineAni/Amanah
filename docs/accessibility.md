# Accessibility

Framed as dignity, not compliance. The headline: the elder's surface is **voice-first by design** — she is not asked to type, navigate menus, or read small text to give her account. Source: `../elderly-care-build-spec.md` §10.

---

## The headline decision

The elder's core action is speaking. One large button, one spoken sentence, one mood tap. Everything an 80-year-old with cataracts, arthritis, and Arabic as a first language is otherwise locked out of — typing, tiny targets, English-only forms, deep navigation — is designed out of her path.

---

## P0 — build these

Built into the five shared primitives once, so every screen inherits them.

- **Semantic HTML** — real `<button>`, `<main>`, `<ul>`. No `<div onClick>`.
- **Every control keyboard-reachable and operable.** Tab order follows visual order. `Enter`/`Space` activate. `Esc` closes dialogs.
- **Visible focus ring** on every interactive element, always.
- **Labels tied to inputs** — every field and control has a programmatic name.
- **The check-in flow is screen-reader legible** — the record button, the "recording"/"writing it down" states, the mood options, and the visibility choice are all announced with role, name, and state.
- **AA contrast minimum** on every text/background pair.
- **44px minimum targets** — the check-in button larger still.
- **200% text-scale survival** — test at the largest elder text-size setting *and* 200% browser zoom together; no clipping, no overlap. The check-in button stays reachable without scrolling.
- **No colour-alone state** — mood markers use shape + label; greyscale pass confirms.
- **No time-limited interactions** — recording is not timer-cut; nothing expires.

---

## Age-specific — designing for an 80-year-old, not just "a11y"

- **Elder-set text-size control** in the app, ≥3 steps, not buried in OS settings. Store state.
- **High-contrast mode** toggle, app-level, via CSS variables.
- **Large, calm elder home** — one thing per line, generous spacing, her day in plain language.
- **Playback of her own words** — she can replay any check-in audio; the transcript is never the only record.

---

## The pitch beat

Do one real screen-reader pass (VoiceOver / TalkBack) on the elder home + check-in flow. Record what you *actually* hear — do not script it. Say it in the pitch:

> "Most teams claim accessibility. I turned on VoiceOver and recorded her check-in. Here's what it actually said."

Almost no team will have done this. ~20 minutes, and it's the credible version of the claim.

---

## Verification checklist (task group 8)

- [ ] Keyboard-only walkthrough of the full demo path — every control reachable, focus visible and sane
- [ ] Screen-reader pass on elder home + check-in — button, recording state, mood, visibility announced with role/name/state; real notes recorded
- [ ] AA contrast verified on all text pairs
- [ ] 44px targets verified; check-in button larger
- [ ] Largest text size + 200% zoom — no clipping; check-in button still reachable without scrolling
- [ ] Greyscale pass — no state by colour alone
- [ ] No interaction times out or discards input
