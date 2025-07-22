# hubctl

A **comprehensive, production-ready CLI tool** for GitHub administration with real GitHub API integration, multiple output formats, interactive prompts, and beautiful error handling.

## ✨ Features

- 🚀 **Full GitHub API Integration** - Real GitHub API calls using Octokit
- 🎨 **Multiple Output Formats** - Table, JSON, and list formats with colored output
- 🛡️ **Comprehensive Error Handling** - Meaningful error messages with suggested solutions
- 🎯 **Interactive Prompts** - Confirmation dialogs and user input with TTY-Prompt
- ⚡ **Loading Indicators** - Spinning animations for API calls
- 🔐 **Flexible Authentication** - Environment variables or configuration file
- 📊 **Beautiful Tables** - Formatted output with TTY-Table
- 🌈 **Colorized Output** - Pastel-powered colored terminal output
- 🔄 **Batch Operations** - Bulk management operations
- 📝 **Detailed Help** - Comprehensive help system with examples

## Installation

### Local Development

```bash
# Clone the repository
git clone <repository-url>
cd hubctl

# Install dependencies
bundle install

# Make the binary executable
chmod +x bin/hubctl

# Run from local directory
./bin/hubctl --help
```

### Build and Install as Gem

```bash
# Build the gem
gem build hubctl.gemspec

# Install locally
gem install hubctl-0.1.0.gem

# Use globally
hubctl --help
```

## Quick Start

1. **Set up authentication:**

   ```bash
   # Option 1: Environment variable (recommended)
   export GITHUB_TOKEN=your_personal_access_token

   # Option 2: Configuration file
   hubctl config init
   hubctl config set github_token your_personal_access_token
   ```

2. **Verify authentication:**

   ```bash
   hubctl auth
   hubctl users whoami
   ```

3. **Set default organization (optional):**

   ```bash
   hubctl config set default_org your-org-name
   ```

## Authentication & Configuration

### GitHub Token Setup

Create a Personal Access Token at <https://github.com/settings/tokens> with appropriate scopes:

- `repo` - Repository access
- `admin:org` - Organization administration
- `read:org` - Read organization data
- `user` - User information

### Configuration Commands

```bash
# Initialize configuration file
hubctl config init

# Show current configuration
hubctl config show

# Get/set specific values
hubctl config get github_token
hubctl config set default_org myorg

# Edit config file in your editor
hubctl config edit

# Show config file path
hubctl config path
```

## Usage Examples

### Global Options

All commands support these global options:

```bash
--format=FORMAT    # Output format: table, json, list (default: table)
--no-color         # Disable colored output
--yes              # Skip confirmation prompts
```

**Output Format Behavior:**

- **Table format**: Both data and log messages go to stdout (standard CLI behavior)
- **JSON/List formats**: Data goes to stdout, log messages go to stderr (keeps output clean for piping/redirection)

### User Management

```bash
# List users in organization (with beautiful table output)
hubctl users list --org=myorg
hubctl users list --org=myorg --role=admin --format=json

# Show detailed user information
hubctl users show octocat
hubctl users whoami

# Invite users to organization
hubctl users invite user@example.com --org=myorg --role=direct_member
hubctl users invite user@example.com --org=myorg --team-ids=123,456

# Remove users (with confirmation prompt)
hubctl users remove username --org=myorg
hubctl users remove username --org=myorg --yes  # Skip confirmation
```

### Team Management

```bash
# List teams with member/repo counts
hubctl teams list --org=myorg

# Create teams with different permissions
hubctl teams create "Frontend Team" --org=myorg \
  --description="Frontend developers" \
  --privacy=closed --permission=push

# Manage team membership
hubctl teams members frontend-team --org=myorg
hubctl teams add-member frontend-team johndoe --org=myorg --role=maintainer
hubctl teams remove-member frontend-team johndoe --org=myorg

# Show team details
hubctl teams show frontend-team --org=myorg
```

### Repository Management

```bash
# List repositories with sorting and filtering
hubctl repos list                                    # Personal repos
hubctl repos list --org=myorg                        # Organization repos
hubctl repos list --type=private --sort=created      # Filter and sort
hubctl repos list --format=json                      # JSON output

# Create repositories with templates
hubctl repos create myrepo \
  --description="My awesome project" \
  --private \
  --gitignore=Node \
  --license=MIT

# Show detailed repository information
hubctl repos show myorg/myrepo

# Clone repositories
hubctl repos clone myorg/myrepo --path=./local-name
hubctl repos clone myorg/myrepo --depth=1  # Shallow clone

# Manage repository topics
hubctl repos topics myorg/myrepo                     # List topics
hubctl repos topics myorg/myrepo --set=ruby,cli,api  # Set topics
hubctl repos topics myorg/myrepo --add=new-topic     # Add topics
hubctl repos topics myorg/myrepo --remove=old-topic  # Remove topics

# Archive repositories (with confirmation)
hubctl repos archive myorg/old-repo
```

### Organization Management

```bash
# List your organizations
hubctl orgs list

# Show detailed organization information
hubctl orgs show myorg

# List organization members with role filtering
hubctl orgs members myorg --role=admin
hubctl orgs members myorg --filter=2fa_disabled

# List organization repositories and teams
hubctl orgs repos myorg --type=private --sort=updated
hubctl orgs teams myorg

# Show authentication info and memberships
hubctl orgs info
```

### Output Format Examples

hubctl supports three output formats optimized for different use cases:

#### Table Format (Default)

Beautiful formatted tables for human consumption:

```bash
# Default table output with colors and formatting
hubctl users list --org=myorg
hubctl orgs list
hubctl repos list --org=myorg
```

#### JSON Format + jq

Perfect for scripting and programmatic access. Log messages go to stderr, keeping stdout clean:

```bash
# Extract specific fields
hubctl users list --org=myorg --format=json | jq '.[] | .login'
hubctl orgs list --format=json | jq '.[].login'

# Filter and transform data
hubctl users list --format=json | jq '.[] | select(.type == "User") | .login'
hubctl repos list --format=json | jq '.[] | select(.private == true) | {name, stars}'

# Complex queries and aggregation
hubctl users list --format=json | jq 'group_by(.type) | map({type: .[0].type, count: length})'
hubctl repos list --format=json | jq 'map(.stars) | add'  # Total stars

# Save data for processing
hubctl users list --format=json > users.json
hubctl orgs list --format=json | jq '.[0]' > org_info.json
```

#### List Format + GNU Tools

Tab-separated values optimized for awk, cut, sort, grep, and other Unix tools:

```bash
# Extract fields with cut
hubctl users list --format=list | cut -f1              # Just usernames
hubctl orgs list --format=list | cut -f1,3             # Names and descriptions
hubctl repos list --format=list | cut -f1,7,8          # Name, stars, forks

# Process with awk
hubctl users list --format=list | awk -F'\t' '{print $1}'                    # Usernames
hubctl users list --format=list | awk -F'\t' '{print NF, $1}'                # Field count + username
hubctl orgs list --format=list | awk -F'\t' '$3 != "-" {print $1 ": " $3}'   # Orgs with descriptions

# Sorting and filtering
hubctl repos list --format=list | sort -t$'\t' -k7 -nr          # Sort by stars (descending)
hubctl users list --format=list | grep -E '^(admin|bot)'        # Users starting with admin/bot
hubctl orgs list --format=list | sort -t$'\t' -k3               # Sort by description

# Counting and statistics
hubctl users list --format=list | awk -F'\t' '{print $3}' | sort | uniq -c    # Count by user type
hubctl repos list --format=list | awk -F'\t' '{sum+=$7} END {print sum}'      # Total stars
hubctl users list --format=list | wc -l                                       # Total users

# Advanced processing
hubctl users list --format=list | awk -F'\t' 'length($1) > 10 {print $1}'    # Long usernames
hubctl repos list --format=list | awk -F'\t' '$2=="false" && $7>100'         # Public repos with 100+ stars
```

#### Combining Formats in Scripts

```bash
#!/bin/bash
# Example: Create a report of org statistics

echo "Organization Report"
echo "=================="

# Get org info in JSON for structured data
ORG_INFO=$(hubctl orgs show myorg --format=json)
ORG_NAME=$(echo "$ORG_INFO" | jq -r '.name // .login')
echo "Organization: $ORG_NAME"

# Use list format for easy counting
USER_COUNT=$(hubctl users list --org=myorg --format=list 2>/dev/null | wc -l)
REPO_COUNT=$(hubctl repos list --org=myorg --format=list 2>/dev/null | wc -l)
TEAM_COUNT=$(hubctl teams list --org=myorg --format=list 2>/dev/null | wc -l)

echo "Users: $USER_COUNT"
echo "Repositories: $REPO_COUNT"
echo "Teams: $TEAM_COUNT"

# Use JSON for complex analysis
echo -e "\nTop repositories by stars:"
hubctl repos list --org=myorg --format=json 2>/dev/null | \
  jq -r 'sort_by(.stars) | reverse | .[0:5] | .[] | "\(.name): \(.stars) stars"'
```

#### Format Selection Guide

- **Table**: Human-readable output, terminal viewing, reports
- **JSON**: Scripts, APIs, complex data processing, integration with other tools
- **List**: Shell scripting, GNU tools (awk/cut/sort), simple data extraction

All formats support the same commands and options - just add `--format=FORMAT` to any command.

## Advanced Features

### Error Handling & Recovery

hubctl provides detailed error messages with suggested solutions:

```bash
$ hubctl users list --org=nonexistent
✗ Resource not found. Please check the name and your permissions.

$ hubctl users list  # No org specified
✗ Organization is required but not specified
ℹ Specify with --org=ORG or set default: hubctl config set default_org ORG
```

### Interactive Features

- **Confirmation prompts** for destructive operations
- **Spinner animations** during API calls
- **Colorized output** with success/error indicators
- **Progress feedback** for long-running operations

### Batch Operations

Skip confirmations for scripting:

```bash
# Remove multiple users in a script
for user in user1 user2 user3; do
  hubctl users remove $user --org=myorg --yes
done
```

## Development

### Project Structure

```
hubctl/
├── bin/hubctl                    # Executable entry point
├── lib/
│   ├── hubctl.rb                # Main module, loads all components
│   └── hubctl/
│       ├── version.rb           # Version constant
│       ├── cli.rb               # Main CLI class with global options
│       ├── base_command.rb      # Base class for all subcommands
│       ├── github_client.rb     # GitHub API client wrapper
│       ├── formatter.rb         # Output formatting utilities
│       ├── config.rb            # Configuration management
│       ├── config_cli.rb        # Config subcommands
│       ├── users.rb             # User management commands
│       ├── teams.rb             # Team management commands
│       ├── repos.rb             # Repository management commands
│       └── orgs.rb              # Organization management commands
├── hubctl.gemspec               # Gem specification
├── Gemfile                      # Dependencies
└── README.md                    # This file
```

### Dependencies

- **thor** ~> 1.4 - CLI framework
- **octokit** ~> 8.0 - GitHub API client
- **tty-prompt** ~> 0.23 - Interactive prompts
- **tty-table** ~> 0.12 - Table formatting
- **tty-spinner** ~> 0.9 - Loading spinners
- **pastel** ~> 0.8 - Colored output
- **json** ~> 2.6 - JSON formatting

### Adding New Commands

1. **Add to existing subcommand:**

   ```ruby
   # In lib/hubctl/users.rb
   desc 'block USER', 'Block a user'
   method_option :org, type: :string, desc: 'Organization name'
   def block(username)
     ensure_authenticated!
     org = require_org!

     begin
       with_spinner("Blocking user") do
         github_client.block_user(org, username)
       end
       formatter.success("Successfully blocked #{username}")
     rescue => e
       handle_error(e)
     end
   end
   ```

2. **Create new subcommand:**
   - Create `lib/hubctl/new_feature.rb` inheriting from `BaseCommand`
   - Add `require_relative` in `lib/hubctl.rb`
   - Add subcommand in `lib/hubctl/cli.rb`

### Error Handling Pattern

```ruby
def my_command
  ensure_authenticated!  # Check GitHub auth
  org = require_org!     # Check organization requirement

  begin
    result = with_spinner("Processing") do
      github_client.some_api_call(params)
    end

    formatter.success("Operation completed")
    formatter.output(result)
  rescue => e
    handle_error(e)  # Consistent error handling
  end
end
```

## Testing

```bash
# Test core functionality
./bin/hubctl --help
./bin/hubctl version
./bin/hubctl auth

# Test with different formats
./bin/hubctl config show
./bin/hubctl config show --format=json
./bin/hubctl config show --no-color

# Test error handling (without token)
./bin/hubctl users list --org=test
```

## Rate Limiting

hubctl automatically handles GitHub's rate limiting:

- Shows rate limit status in `hubctl auth`
- Provides meaningful error messages when limits exceeded
- Uses auto-pagination for large result sets

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes following the established patterns
4. Add tests if applicable
5. Commit your changes (`git commit -m 'Add amazing feature'`)
6. Push to the branch (`git push origin feature/amazing-feature`)
7. Open a Pull Request

## License

MIT License - see LICENSE file for details.

## Changelog

### v0.1.0 (Latest)

- ✅ Complete GitHub API integration with Octokit
- ✅ Multiple output formats (table, JSON, list)
- ✅ Interactive prompts and confirmations
- ✅ Comprehensive error handling
- ✅ Colored output and loading spinners
- ✅ Configuration management system
- ✅ Full user, team, repository, and organization management
- ✅ Repository topics management
- ✅ Batch operations support
- ✅ Authentication status checking
- ✅ Rate limit monitoring

## Examples in Action

```bash
# Beautiful table output with colors
$ hubctl users list --org=octocat
┌─────────────┬────────┬──────┬────────────┬─────────────────────────────────┐
│ login       │ id     │ type │ site_admin │ url                             │
├─────────────┼────────┼──────┼────────────┼─────────────────────────────────┤
│ octocat     │ 1      │ User │ ✗          │ https://github.com/octocat      │
│ defunkt     │ 2      │ User │ ✗          │ https://github.com/defunkt      │
└─────────────┴────────┴──────┴────────────┴─────────────────────────────────┘
✓ Found 2 users in octocat

# JSON output for scripting
$ hubctl repos list --format=json | jq '.[0].name'
"Hello-World"

# Interactive confirmation
$ hubctl users remove baduser --org=myorg
? Are you sure you want to remove baduser from myorg? No
ℹ Operation cancelled
```

**hubctl** - Making GitHub administration beautiful, reliable, and efficient! 🚀
