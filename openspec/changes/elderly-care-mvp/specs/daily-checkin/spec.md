## Purpose

Defines the elder's daily check-in: a short spoken account of how her day actually went, captured with one action in her own language, that becomes the raw material for every downstream decision about her care.

## ADDED Requirements

### Requirement: One-action voice capture

The system SHALL let the elder start a check-in with a single large control and record spoken audio without further navigation. The control SHALL be reachable from the elder's home screen without scrolling and SHALL meet a minimum 44px target. Recording SHALL NOT be time-limited in a way that discards audio; the elder SHALL be able to stop when she is done.

#### Scenario: Start and stop a check-in

- **WHEN** the elder taps the check-in control on her home screen and speaks
- **THEN** audio is captured until she taps stop
- **AND** no step expires or discards the recording due to elapsed time

#### Scenario: Capture is reachable without scrolling

- **WHEN** the elder opens her home screen at the largest text-size setting
- **THEN** the check-in control is visible without scrolling and is at least 44px

### Requirement: Transcription in the elder's language with audio retained

The system SHALL transcribe the recorded audio in the language the elder spoke, retain the original audio with the entry, and produce a caregiver-facing rendering in the care team's working language. The elder's own words SHALL always be available alongside any translation.

#### Scenario: Arabic check-in is transcribed and translated

- **WHEN** the elder records a check-in spoken in Arabic
- **THEN** the entry stores an Arabic transcript, the original audio, and a French/English rendering
- **AND** all three are retrievable from the entry

#### Scenario: Translation never replaces the original

- **WHEN** a caregiver views a translated check-in
- **THEN** the elder's original words (text and audio) remain accessible from that view

### Requirement: One mood value per check-in

The system SHALL let the elder attach exactly one mood value to a check-in from a small fixed set, selected by large touch targets that are not distinguished by colour alone. The mood value SHALL NOT be a clinical scale or numeric score.

#### Scenario: Mood is picked with a non-colour-coded control

- **WHEN** the elder selects a mood for her check-in
- **THEN** each option is distinguishable by shape or label without relying on colour
- **AND** exactly one mood is recorded

#### Scenario: No scoring

- **WHEN** a check-in is stored
- **THEN** it holds a mood label and free text, and no computed score, index, or clinical-scale result

### Requirement: Check-in entry is dated and attributed to the elder

The system SHALL store each check-in as a dated entry attributed to the elder, containing the transcript, the translation, the audio reference, the mood, and a visibility setting. One check-in per day is expected; a second the same day SHALL update or append, not silently overwrite history.

#### Scenario: Entry carries its date and author

- **WHEN** a check-in is saved
- **THEN** it records the date and that the elder is the author

#### Scenario: A second check-in the same day preserves the first

- **WHEN** the elder records a second check-in on a day that already has one
- **THEN** the earlier check-in is still retrievable

### Requirement: Offline demo mode

The system SHALL provide a mode in which check-in capture produces an entry from pre-recorded audio and/or a cached transcript without any network call, so the flow can be demonstrated with no connectivity.

#### Scenario: Check-in completes with no network

- **WHEN** offline demo mode is active and the elder completes a check-in
- **THEN** an entry is produced with transcript, translation, mood, and audio
- **AND** no request to the transcription service is made

### Requirement: Transcription, not interpretation

The system SHALL record what the elder said. It SHALL NOT infer diagnoses, generate care advice, or derive a clinical assessment from the check-in content.

#### Scenario: No advice generated from a check-in

- **WHEN** a check-in describes a physical or emotional complaint
- **THEN** the system stores and displays her words
- **AND** it does not produce a recommendation, alert threshold, or assessment
