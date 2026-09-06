## Purpose

Defines elder-owned consent over her own account: the elder decides who can see the words of each daily check-in, and the system enforces that through a single read-filter so a hidden note never leaks while its mood still contributes to the trend.

## ADDED Requirements

### Requirement: Per-check-in visibility owned by the elder

The system SHALL let the elder set a visibility on each check-in note from {everyone in the circle, family only, coordinator only, mood only}. The default for a new check-in SHALL be "family only". Only the elder SHALL change a check-in's visibility.

#### Scenario: Elder restricts a note after recording it

- **WHEN** the elder changes tonight's check-in from "everyone in the circle" to "family only"
- **THEN** the visibility is updated immediately
- **AND** the change takes effect on the next read by any viewer without a reload

#### Scenario: Non-elder cannot change visibility

- **WHEN** a coordinator, caregiver, or family member views a check-in
- **THEN** no control to change its visibility is offered

#### Scenario: New check-in defaults to family only

- **WHEN** the elder saves a check-in without choosing a visibility
- **THEN** its visibility is "family only"
- **AND** the view shows this is the default

### Requirement: Single enforced read path

The system SHALL route every read of a check-in through one filter function that takes the check-in and the current viewer and returns what that viewer may see: the full note, or the mood only, or nothing. No surface SHALL read check-in content by a path that bypasses this filter.

#### Scenario: Family-only note hidden from the hired caregiver

- **WHEN** a check-in note is set to "family only" and a hired (non-family) caregiver opens their shift
- **THEN** the shift view shows the elder's mood for that check-in but not the words
- **AND** a neutral indication that a note exists is shown, with no excerpt

#### Scenario: Same note visible to a family member

- **WHEN** a family member opens the care-signal view under the same "family only" note
- **THEN** they see the full transcript and audio for that check-in

#### Scenario: Mood-only visibility still trends

- **WHEN** a check-in is set to "mood only"
- **THEN** its mood dot still appears on the week strip for all permitted viewers
- **AND** no viewer other than the elder sees the words

#### Scenario: Filter is consistent across surfaces

- **WHEN** a check-in is set to "coordinator only"
- **THEN** the words are hidden in the caregiver shift view and the family view alike
- **AND** they remain visible to the coordinator

### Requirement: Hidden content does not leak through its placeholder

When a check-in's words are hidden from a viewer, the system SHALL show either nothing or a neutral indication that a note exists. It SHALL NOT reveal the text, its length, or identifying detail.

#### Scenario: Placeholder reveals nothing

- **WHEN** a viewer is denied a check-in note by the filter
- **THEN** any indication shown contains no part of the note and no detail that identifies its content

### Requirement: The elder always sees her own account in full

The system SHALL always show the elder every check-in she recorded, with its transcript, translation, audio, mood, and current visibility.

#### Scenario: Elder reviews her week

- **WHEN** the elder opens her own check-in history
- **THEN** every entry is shown in full regardless of its visibility setting
- **AND** each entry shows who else can currently see it
