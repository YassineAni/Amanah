## Purpose

Defines what the elder's check-ins do: they trend, they sit beside the schedule so patterns are visible, they give a caregiver context before a shift, they show remote family how she is, and they let the coordinator change the schedule in response. This is the loop that makes the check-in more than a diary.

## ADDED Requirements

### Requirement: Schedule substrate

The system SHALL maintain a schedule of shifts, each with a date/time window, one assigned caregiver (or unassigned), a purpose, and zero or more activity tags from a small fixed set (for example: garden, outing, physio, companionship, personal care, errands). The schedule exists so check-ins can be read against it.

#### Scenario: A shift carries activity tags

- **WHEN** a shift is displayed
- **THEN** it shows its assigned caregiver (or that it is unassigned), its purpose, and its activity tags

### Requirement: Week strip beside the schedule

The system SHALL present the elder's check-ins as a trend over a rolling window (at least seven days), each day showing its mood, positioned so it can be read alongside that day's shifts and activity tags. Mood on the strip SHALL be conveyed by more than colour.

#### Scenario: Good and hard days are visible against the schedule

- **WHEN** the coordinator opens the care-signal view
- **THEN** each day shows the elder's mood and that day's caregivers and activities in a single aligned view
- **AND** mood is distinguishable without relying on colour

#### Scenario: A day with no check-in reads as missing, not as neutral

- **WHEN** a day in the window has no check-in
- **THEN** it is shown as "no check-in" rather than as an average or neutral mood

### Requirement: Caregiver sees yesterday's context at shift start

The system SHALL surface, at the top of a caregiver's shift view, a one-line context drawn from the elder's most recent check-in that the caregiver is permitted to see — her mood and, if permitted, a short excerpt of her words. If the caregiver is not permitted to see the note, only the mood is shown.

#### Scenario: Permitted caregiver sees mood and excerpt

- **WHEN** a caregiver opens a shift and the most recent check-in is visible to them
- **THEN** the shift view shows the elder's mood and a short excerpt of her words at the top

#### Scenario: Restricted caregiver sees mood only

- **WHEN** the most recent check-in note is set to a visibility that excludes this caregiver
- **THEN** the shift view shows the mood but not the words, with a neutral indication that a note exists

### Requirement: Remote family sees the trend and her words

The system SHALL give family members a view of the check-in trend over the window and the elder's own words for each day they are permitted to see, so a remote family member can tell how she is without a phone call.

#### Scenario: Family view shows her account

- **WHEN** a family member opens the care-signal view
- **THEN** they see the mood trend and, for permitted days, the elder's transcript and audio

### Requirement: Coordinator can change the schedule from the signal

The system SHALL let the coordinator modify the schedule — reassign a caregiver, move or retag an activity — from within the care-signal view, so a change can be made in direct response to the pattern.

#### Scenario: Reschedule in response to the pattern

- **WHEN** the coordinator moves a garden activity to earlier in the week from the care-signal view
- **THEN** the schedule updates
- **AND** the week strip reflects the new arrangement for future days

### Requirement: Correlation callout

The system SHALL surface at most one plain-language callout describing a co-occurrence between the elder's good or hard days and a schedule attribute, computed by a simple deterministic rule over the visible window. The callout SHALL be phrased as an observation, not a recommendation, and SHALL NOT claim causation.

#### Scenario: Callout is observational

- **WHEN** the visible window shows three of four good days included a garden activity
- **THEN** a callout states that observation in plain language
- **AND** it does not tell the coordinator what to do or assert that the garden caused the good days

#### Scenario: No callout when there is no clear co-occurrence

- **WHEN** no schedule attribute clearly co-occurs with good or hard days in the window
- **THEN** no callout is shown

### Requirement: Prayer-time collision flag

The system SHALL flag, at the time an activity is scheduled or moved, when the activity's time falls within 30 minutes before a prayer time for the demo date. The flag SHALL name the prayer and its time and appear before the change is confirmed.

#### Scenario: Activity near a prayer time is flagged

- **WHEN** the coordinator schedules an activity at a time within 30 minutes before Dhuhr
- **THEN** a flag naming Dhuhr and its time is shown before the schedule change is confirmed
