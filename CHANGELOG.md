# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.1] - 2025-07-24

### Fixed
- **Nix build compatibility** - Resolved network access issues during Nix build process
- **Gem dependency hashing** - Fixed gem hash mismatches that prevented successful builds in Nix environment
- **Build reproducibility** - Improved consistency of builds across different environments

### Technical Details
- Updated `flake.nix` and related Nix configuration for better network handling
- Resolved gem dependency conflicts that affected build determinism
- Enhanced build process documentation for Nix-based development workflows

## [0.2.0] - 2025-07-23

### Added

**🏢 Enterprise Management Features:**
- **Complete GitHub Enterprise Cloud support** with comprehensive billing analytics
- **Enterprise billing insights** - Actions, Packages, Copilot usage with cost breakdowns by runner type
- **Member & owner management** - Role-based access control with 2FA monitoring and SAML identity tracking
- **SAML SSO authorization management** - List, show, and remove SAML SSO authorizations
- **Security analysis settings** - Configure dependency graph, secret scanning, and push protection for new repositories
- **Enterprise audit log access** - Full audit trail with phrase and time range filtering
- **Organization creation & management** within enterprises with billing email configuration
- **Multi-format output support** - JSON, table, and list formats for all enterprise commands
- **Enterprise statistics & metrics** - Comprehensive reporting capabilities including repository, user, and team counts

**🔧 Core Improvements:**
- **Enhanced formatter system** - Added `json?` detection method for format-aware output
- **Improved output formatting** - Better handling of nested data structures in table vs JSON output
- **GitHub Enterprise Cloud API compatibility** - Full support for Cloud vs Server API differences

### Changed
- **Enterprise billing output** - Now provides structured JSON for automation and flattened table for human readability
- **Paginated API calls** - Improved handling of large result sets for enterprise member and owner commands
- **Error handling** - Better error messages for Enterprise Cloud specific endpoints

### Fixed
- **Format detection** - Fixed issue where `--format json` was not properly detected in subcommands
- **Percentage calculations** - Corrected runner type usage percentage calculations in billing reports
- **API endpoint compatibility** - Updated to use correct Enterprise Cloud endpoints vs deprecated Server endpoints

### Technical Details
- Added `lib/hubctl/enterprise.rb` with comprehensive enterprise management commands
- Enhanced `lib/hubctl/formatter.rb` with `json?` method for format detection
- Updated test suite with new enterprise-specific test cases
- Added `flatten_billing_summary` helper for table-friendly data presentation
- Implemented manual pagination for enterprise member/owner commands due to API limitations

## [0.1.0] - 2025-07-22

### Added
- **Complete GitHub API integration** with Octokit
- **Multiple output formats** - Table, JSON, and list formats with colored output
- **Interactive prompts and confirmations** - TTY-Prompt powered user interactions
- **Comprehensive error handling** - Meaningful error messages with suggested solutions
- **Colored output and loading spinners** - Beautiful terminal experience with Pastel and TTY-Spinner
- **Configuration management system** - File-based configuration with environment variable support
- **Full user management** - List, invite, remove users with role and 2FA filtering
- **Team management** - Create, manage teams and membership with permission controls
- **Repository management** - Create, clone, archive repositories with topic management
- **Organization management** - List organizations, members, repositories, and teams
- **Repository topics management** - Add, remove, and set repository topics
- **Batch operations support** - Skip confirmations for scripting workflows
- **Authentication status checking** - Verify GitHub authentication and rate limits
- **Rate limit monitoring** - Automatic handling of GitHub API rate limits

### Technical Foundation
- **Thor-based CLI framework** with structured subcommands
- **Octokit GitHub API client** with comprehensive API coverage
- **TTY gem suite integration** for beautiful terminal interfaces
- **Modular architecture** with base command pattern for consistency
- **Comprehensive test coverage** with RSpec and SimpleCov
- **Gem packaging** for easy installation and distribution

---

## Version Numbering

This project follows [Semantic Versioning](https://semver.org/):

- **MAJOR** version when you make incompatible API changes
- **MINOR** version when you add functionality in a backwards compatible manner  
- **PATCH** version when you make backwards compatible bug fixes

## Release Process

1. Update version in `lib/hubctl/version.rb`
2. Update version in `hubctl.gemspec`
3. Update this CHANGELOG.md
4. Update README.md installation examples
5. Create git tag: `git tag v0.x.x`
6. Build and release gem: `gem build hubctl.gemspec && gem push hubctl-0.x.x.gem`
