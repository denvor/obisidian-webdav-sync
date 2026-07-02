## ADDED Requirements

### Requirement: Full bidirectional sync
The system SHALL synchronize files between the local Obsidian vault and the remote WebDAV storage in both directions.

#### Scenario: New local file uploaded to remote
- **WHEN** a file exists locally but not on the remote server
- **THEN** the system uploads the file to the remote server via WebDAV PUT

#### Scenario: New remote file downloaded to local
- **WHEN** a file exists on the remote server but not locally
- **THEN** the system downloads the file to the local vault via WebDAV GET

#### Scenario: Modified local file updated on remote
- **WHEN** a file has been modified locally but not on the remote
- **THEN** the system uploads the updated content to the remote server

#### Scenario: Modified remote file updated locally
- **WHEN** a file has been modified on the remote server but not locally
- **THEN** the system downloads the updated content to the local vault

#### Scenario: Deleted local file removed from remote
- **WHEN** a file was deleted locally but still exists on the remote server
- **THEN** the system deletes the file from the remote server via WebDAV DELETE

#### Scenario: Deleted remote file removed locally
- **WHEN** a file was deleted from the remote server but still exists locally
- **THEN** the system deletes the file from the local vault

#### Scenario: Upload-only mode
- **WHEN** sync direction is set to "仅上传"
- **THEN** only local-to-remote operations are performed; remote deletions or new remote files are ignored

#### Scenario: Download-only mode
- **WHEN** sync direction is set to "仅下载"
- **THEN** only remote-to-local operations are performed; local deletions or new local files are ignored

#### Scenario: Directory structure preserved
- **WHEN** syncing files in subdirectories (e.g., `notes/sub/daily.md`)
- **THEN** corresponding remote directories are created automatically via WebDAV MKCOL before file upload

#### Scenario: Sync progress visible
- **WHEN** a sync operation is in progress
- **THEN** the system shows progress (current file / total files) in the sync status

#### Scenario: Large file handling
- **WHEN** a single file exceeds 100MB
- **THEN** the system attempts upload/download with appropriate timeout settings

#### Scenario: Network error during sync
- **WHEN** a network error occurs during file transfer
- **THEN** the system retries up to 3 times, then skips the file and continues with remaining files
