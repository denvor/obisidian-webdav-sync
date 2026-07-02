## ADDED Requirements

### Requirement: Auto-resolve conflicts by timestamp
The system SHALL detect when a file has been modified on both sides since last sync and resolve by keeping the newer version while backing up the older version.

#### Scenario: Conflict detected when both sides modified
- **WHEN** a file has been modified both locally and remotely since the last successful sync
- **THEN** the system marks it as a conflict and applies the newer_wins strategy

#### Scenario: Newer local file wins, remote backed up
- **WHEN** local file mtime is newer than remote file mtime
- **THEN** local version is uploaded to the original path, and the remote old version is renamed to `filename.YYYY-MM-DD_HHmmss.ext` via WebDAV MOVE

#### Scenario: Newer remote file wins, local backed up
- **WHEN** remote file mtime is newer than local file mtime
- **THEN** remote version is downloaded to the original path, and the local old version is renamed to `filename.YYYY-MM-DD_HHmmss.ext`

#### Scenario: Conflict backup format
- **WHEN** a file is renamed as a conflict backup
- **THEN** the new filename follows the format `{basename}.{YYYY-MM-DD}_{HHmmss}{ext}` (e.g., `notes.2026-07-01_153045.md`)

#### Scenario: Conflict reported in sync log
- **WHEN** a conflict occurs and is resolved
- **THEN** the sync log shows "⚠️ 冲突备份" for that file, including the backup filename

### Requirement: No false conflict on single-side changes
The system SHALL NOT treat a file as a conflict when only one side has changed since last sync.

#### Scenario: Local-only change is not a conflict
- **WHEN** a file was modified locally but the remote version has not changed since last sync
- **THEN** the system performs a normal upload without triggering conflict handling

#### Scenario: Remote-only change is not a conflict
- **WHEN** a file was modified on the remote server but the local version has not changed since last sync
- **THEN** the system performs a normal download without triggering conflict handling
