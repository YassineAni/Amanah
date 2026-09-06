# Data model

Small. Nothing clinical. The check-in is the centre; everything else exists so the check-in has something to be read against.

---

## Objects

### Person (circle member)

| Field | Type | Note |
|---|---|---|
| `id` | string | |
| `name` | string | |
| `role` | `'elder' \| 'coordinator' \| 'caregiver' \| 'observer'` | exactly one |
| `isFamily` | boolean | hired caregiver = `false`; drives the `family` visibility level |
| `lang` | `'ar' \| 'fr' \| 'en'` | the elder's is the language she speaks her check-ins in |

Circle in the store: `elder: Person`, `circle: Person[]` (includes the elder).

### Shift

| Field | Type | Note |
|---|---|---|
| `id` | string | |
| `caregiverId` | string \| null | null = unassigned |
| `start` / `end` | ISO datetime | dated around `DEMO_DATE` |
| `purpose` | string | short, e.g. "Afternoon" |
| `activityTags` | `ActivityTag[]` | see enum |

`ActivityTag = 'garden' | 'outing' | 'physio' | 'companionship' | 'personal-care' | 'errands'`

### Checkin (the centre)

| Field | Type | Note |
|---|---|---|
| `id` | string | |
| `date` | ISO date | one expected per day; a second appends |
| `authorId` | string | always the elder |
| `mood` | `Mood` | one value, no score |
| `transcript` | string | in the elder's language |
| `translation` | string | care-team working language |
| `audioRef` | string | key/path to the retained recording |
| `spokenLang` | `'ar' \| 'fr' \| 'en'` | |
| `visibility` | `CheckinVisibility` | default `'family'` |
| `createdVia` | `'live' \| 'demo'` | provenance, for the honest real-vs-mock line |

`Mood = 'good' | 'ok' | 'hard'` — three discrete values. Rendered as shape + label, never colour alone. **No numeric scale, no average, no derived index — ever.**

`CheckinVisibility = 'circle' | 'family' | 'coordinator' | 'mood-only'` — default `'family'`.

### PrayerTimes

`{ fajr, dhuhr, asr, maghrib, isha }` as `HH:MM` strings for `DEMO_DATE`. From `getPrayerTimes(DEMO_DATE)`, hardcoded.

---

## visibleCheckin truth table

`viewer` roles: elder / coordinator / family (`isFamily` caregiver or family member) / hired caregiver (`!isFamily`) / observer (`!isFamily`).

| visibility | elder | coordinator | family | hired caregiver | observer |
|---|---|---|---|---|---|
| `circle` | full | full | full | full | full |
| `family` | full | full | full | mood | mood |
| `coordinator` | full | full | mood | mood | mood |
| `mood-only` | full | mood | mood | mood | mood |

`mood` and `none` still render the mood dot on the week strip. Only `none` is currently unused (kept in the return type for a future "truly private" level). The elder row is always `full` (bypass).

---

## Week strip / care-signal grid

Columns = days in the window (≥7, centred on `DEMO_DATE`). Rows:

1. **mood** — `good` = filled circle + "good"; `ok` = half circle + "ok"; `hard` = open square + "hard"; no check-in = "—" ("no check-in"), never treated as a value. If a day has two check-ins, the strip shows the **latest** one's mood; both remain in history.
2. **caregiver** — that day's assigned caregiver name(s).
3. **activity tags** — that day's shift tags.

Coordinator edits rows 2–3 in place. That edit is the loop closing on screen.

---

## Correlation callout (P1) — the rule

Over the visible window, for each `ActivityTag` and each `caregiverId`:

- guard: only compute if the window has **≥3 `good` days and ≥2 `hard` days** (else no callout — avoids divide-by-zero and small-n noise). Days with no check-in are excluded from both counts.
- `goodRate` = (days with this attribute that are `good`) / (all `good` days)
- `hardRate` = (days with this attribute that are `hard`) / (all `hard` days)
- emit if `goodRate >= 0.6` AND `hardRate <= 0.34` (or the mirror image for a "hard day" pattern)

Emit **at most one** callout (highest `goodRate - hardRate`). Phrase as observation: *"3 of her 4 good days this week included time in the garden."* Never "so schedule more garden", never "the garden improved her mood".

---

## Seed (`data/seed.ts`)

- `DEMO_DATE` constant. All shifts dated within ±3 days of it.
- **Elder** — name, `lang: 'ar'`.
- **Circle of 6**: elder; coordinator (`isFamily: true`); two family caregivers (`isFamily: true`, one is "Amina"); one hired caregiver "the new aide" (`role: 'caregiver'`, `isFamily: false`); the remote daughter (`role: 'observer'`, `isFamily: true`) — she must be family so the demo step-4 family view shows the full note.
- **Shifts** — one per day for the window. Arrange so:
  - good days ↔ Amina + `garden`
  - hard days ↔ the new aide, no garden
  - one day physio, one day an outing, one day no check-in
  - one upcoming unassigned shift for the coordinator to fill in the demo
- **Check-ins** — ~7 historical, matching the arrangement above. At least one `hard` day carries a `family`-visible note with a personal line ("kept thinking about my sister") — this is the consent money-shot. One day has no check-in.
- **Pre-recorded utterances** for demo mode: 2–3 short audio files (Arabic) + canned transcript + translation, one of them the "today was good, Amina took me to the garden" line used live in the script.
- `getPrayerTimes(DEMO_DATE)` values with Dhuhr positioned so a demo activity can be dragged into the 30-minute pre-Dhuhr window (P1).
- All check-ins `createdVia: 'demo'` except any recorded live during the demo.
