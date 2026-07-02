## ADDED Requirements

### Requirement: Always exclude .obsidian directory
The system SHALL always exclude the `.obsidian/` directory from sync to prevent corrupting plugin configuration.

#### Scenario: .obsidian files are never synced
- **WHEN** scanning the vault for sync
- **THEN** all files under `.obsidian/` are automatically excluded regardless of user filter settings

#### Scenario: .obsidian file changes ignored
- **WHEN** a file under `.obsidian/` is modified or saved
- **THEN** no sync action is triggered for that file

### Requirement: User-configurable include patterns
The system SHALL allow users to specify glob patterns for files to include in sync.

#### Scenario: Include pattern filters synced files
- **WHEN** user sets include pattern to `*.md` and there is a `.md` file and a `.png` file
- **THEN** only the `.md` file is synced

#### Scenario: Empty include pattern means all files
- **WHEN** user leaves include pattern empty
- **THEN** all non-excluded files are synced

#### Scenario: Multiple include patterns
- **WHEN** user specifies multiple patterns (e.g., `*.md\n*.txt`)
- **THEN** files matching any of the patterns are included

### Requirement: User-configurable exclude patterns
The system SHALL allow users to specify glob patterns for files to exclude from sync.

#### Scenario: Exclude pattern prevents sync
- **WHEN** user sets exclude pattern to `archive/**` and there is a file `archive/old.md`
- **THEN** `archive/old.md` is not synced

#### Scenario: Exclude overrides include
- **WHEN** a file matches both include and exclude patterns
- **THEN** exclude takes precedence (the file is not synced)

### Requirement: Glob pattern format
The system SHALL support standard glob patterns for file filtering.

#### Scenario: Wildcard pattern
- **WHEN** pattern `*.md` is configured
- **THEN** all markdown files in the vault root are matched

#### Scenario: Double-star directory pattern
- **WHEN** pattern `assets/**` is configured
- **THEN** all files under the `assets/` directory (any depth) are matched

#### Scenario: Extension filter
- **WHEN** pattern `*.{png,jpg}` is configured
- **THEN** both .png and .jpg files are matched
