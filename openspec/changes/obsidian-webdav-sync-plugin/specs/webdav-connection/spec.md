## ADDED Requirements

### Requirement: Configure WebDAV connection
The system SHALL allow users to configure WebDAV server connection via the settings interface.

#### Scenario: Set server URL
- **WHEN** user enters a valid HTTPS URL in the "服务器地址" field and saves settings
- **THEN** the URL is persisted in plugin data

#### Scenario: Set username and password
- **WHEN** user enters username and password in the settings fields and saves
- **THEN** credentials are persisted (password stored in Obsidian plugin data)

#### Scenario: Test connection
- **WHEN** user clicks "测试连接" button
- **THEN** system sends a PROPFIND request to the configured URL and shows success/failure status

#### Scenario: Connection failure shows error
- **WHEN** server is unreachable or credentials are invalid
- **THEN** system shows an error message with the specific failure reason

#### Scenario: Empty URL shows warning
- **WHEN** user clicks "测试连接" without entering a server URL
- **THEN** system shows a warning "请先输入服务器地址"
