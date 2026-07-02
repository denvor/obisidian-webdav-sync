## ADDED Requirements

### Requirement: Manual sync via command
The system SHALL provide a command that users can trigger from Obsidian's command palette.

#### Scenario: Sync command available
- **WHEN** the plugin is loaded
- **THEN** the command "Sync with WebDAV" is registered in Obsidian's command palette

#### Scenario: Manual sync executes full sync
- **WHEN** user activates the "Sync with WebDAV" command
- **THEN** the system runs a full bidirectional sync

### Requirement: Auto-sync on file save
The system SHALL automatically sync a file when it is saved in Obsidian, if enabled in settings.

#### Scenario: Save triggers single-file sync
- **WHEN** user saves a file in Obsidian and "保存时自动同步" is enabled
- **THEN** the system syncs that specific file (upload if modified locally, download if not)

#### Scenario: Save sync is debounced
- **WHEN** user saves multiple files rapidly
- **THEN** the system debounces the sync trigger to avoid excessive requests

#### Scenario: Save sync respects direction setting
- **WHEN** sync direction is set to "仅下载" and a local file is saved
- **THEN** the system does NOT upload the saved file

### Requirement: Scheduled sync on interval
The system SHALL automatically sync on a configurable timer interval, if enabled in settings.

#### Scenario: Timer triggers full sync
- **WHEN** the configured interval has elapsed and "定时同步" is enabled
- **THEN** the system runs a full bidirectional sync

#### Scenario: Timer interval configurable
- **WHEN** user changes the timer interval in settings (in minutes)
- **THEN** the timer is reset with the new interval

#### Scenario: Interval set to 0 disables timer
- **WHEN** user sets the interval to 0
- **THEN** the timer sync is disabled

### Requirement: Sync on startup
The system SHALL automatically sync shortly after Obsidian starts, if enabled in settings.

#### Scenario: Startup sync after delay
- **WHEN** Obsidian opens with the plugin loaded and "启动时自动同步" is enabled
- **THEN** the system waits 5 seconds then runs a full bidirectional sync

### Requirement: Multiple triggers work together
The system SHALL support any combination of trigger modes.

#### Scenario: Multiple triggers enabled
- **WHEN** all four trigger modes are enabled simultaneously
- **THEN** each trigger independently initiates syncs according to its own behavior

#### Scenario: Skip sync if already syncing
- **WHEN** a sync is already in progress and a new trigger fires
- **THEN** the new trigger is skipped (a sync is already running)
