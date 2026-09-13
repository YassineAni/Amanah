# Guardrails

Non-negotiable. If a feature idea violates one, the idea is wrong, not the guardrail.

---

## 1. Never clinical

The system records the elder's account. It never assesses or advises.


- Diagnoses, medication dosages/schedules as fields, vitals thresholds, triage logic
- **Mood scoring of any kind** — no 1–5 scale, no PHQ-9 or other instrument, no computed average, index, or "wellbeing score", no trend number
- Any generated advice about care

**Allowed:** three discrete mood labels she picks herself (`good` / `ok` / `hard`), her own words, and a deterministic co-occurrence observation that never claims causation.

The test: if the system is producing a judgement a clinician would be liable for, back it out.

---

## 2. Transcription, never interpretation

Whisper writes down what she said, in her language, plus a translation. It does not summarise into "concerns", extract symptoms, infer a diagnosis, or decide what matters. Her words are stored and shown; the original audio is always kept and reachable.

---

## 3. The elder owns her account

- Each check-in's visibility is set by the elder and only the elder. Default `family`.
- She can change a check-in's visibility after recording it; it takes effect on the next read.
- She always sees every check-in she made, in full, plus who else can currently see it.
- Every read of a check-in goes through `visibleCheckin(checkin, viewer)`. No screen reads `store.checkins` for display.
- A restricted note is replaced by nothing or a neutral "a note exists" — never an excerpt, a length, or identifying detail.
- Her mood dot always trends, whatever the visibility. A privacy choice never breaks the signal.

**This is a client-side filter, not a security boundary.** No server; a viewer with dev tools can reach a hidden note in the bundle. Fine for a demo with fictional data, said openly. Do not describe it to judges as "secure" — describe it as "she sets who hears it, and every read goes through one function."

---

## 4. The mood dot is discrete, never a number

The strip shows `good` / `ok` / `hard` as shape + label, and "no check-in" as a gap. Never an average of the week, never a percentage, never a line chart implying a continuous scale.

---

## 5. Never rely on colour alone

Mood markers, schedule states, flags — all carry a shape, label, or icon as well as colour. Greyscale pass confirms it.

---

## 6. No time-limited interactions

Recording is not cut off by a timer. No step expires or discards input. Accessibility requirement and demo-reliability requirement both.

---

## 7. Offline must work

An offline demo mode produces a complete check-in (transcript, translation, mood, audio) from pre-recorded material with zero network calls. It is the default on stage. Every scripted line has a pre-recorded fallback.

---

## 8. Honesty about what is mocked

Say it out loud: Whisper is real but demo mode uses clips; history is seeded; the correlation line is a rule not ML and asserts no causation; users are seeded; prayer times are hardcoded. Presenting mocks openly reads as competence.

---

## 9. Not a medical device

State it in the roadmap framing. Real elder data — including voice recordings — is sensitive personal information under Quebec Law 25, with consent, retention, and access-log duties this demo does not implement. Sending that audio to OpenAI (a US processor) is a cross-border transfer of sensitive PI that Law 25 would require a privacy impact assessment for; the roadmap answer is Canadian/on-prem transcription or explicit consent. All demo data is fictional; the app shows a "demo — fictional data" marker on every screen.

## 10. Protect the Whisper key

`import.meta.env.VITE_*` is bundled into the client — a live-mode build ships the OpenAI key to every browser. So: set a hard spending cap on the key, never deploy the live-mode build to a public URL, and delete/rotate the key right after the hackathon. Demo mode (the stage default) makes no API call. A serverless proxy is the real fix; out of scope for 24h.
