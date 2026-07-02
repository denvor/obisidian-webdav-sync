## ADDED Requirements

### Requirement: Persist file sync state
The system SHALL maintain a persistent state file that records the last known sync status for each file, enabling incremental syncs.

#### Scenario: State written after each sync
- **WHEN** a sync completes
- **THEN** the system writes a JSON state file to `.obsidian/plugins/webdav-sync/file-states.json`

#### Scenario: State contains required fields
- **WHEN** the state file is read
- **THEN** each entry MUST contain: `path` (relative vault path), `localMtime` (unix timestamp), `localHash` (SHA-256 first 16 hex chars), `remoteMtime` (unix timestamp or null), `remoteHash` (ETag string or null), `status` (synced/pending_upload/pending_download/conflict)

#### Scenario: State loaded on startup
- **WHEN** plugin loads
- **THEN** the system reads the state file to determine previous sync status

#### Scenario: New file added to state
- **WHEN** a file is synced for the first time
- **THEN** a new entry is added to the state with its hash and mtime

#### Scenario: Removed file cleaned from state
- **WHEN** a file was in the state but no longer exists locally or remotely
- **THEN** its entry is removed from the state file

#### Scenario: State file not found on first run
- **WHEN** the plugin runs for the first time and no state file exists
- **THEN** all local files are treated as "new" and the system performs a full sync

### Requirement: Detect changes using hash and mtime
The system SHALL use both SHA-256 hash (first 16 hex characters) and mtime to detect file changes.

#### Scenario: Same hash and mtime → no change
- **WHEN** a file's current local hash and mtime match the stored state
- **THEN** the file is considered unchanged

#### Scenario: Different mtime with same hash → no content change
- **WHEN** a file's mtime differs but its hash matches the stored state
- **THEN** the file is considered unchanged (only metadata touched)

#### Scenario: Different hash → content changed
- **WHEN** a file's hash differs from the stored state
- **THEN** the file is considered modified and queued for sync

### Requirement: State file is JSON format
The system SHALL store state in a human-readable JSON file, not a database.

#### Scenario: State file is valid JSON
- **WHEN** the state file is opened in any text editor
- **THEN** it is valid JSON and human-readable

#### Scenario: State file backup on migration
- **WHEN** the vault is opened on a different device
- **THEN** the state file travels with the vault (since it's inside `.obsidian/`)
