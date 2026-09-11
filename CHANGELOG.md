# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> Going forward this changelog is owned by [release-please](https://github.com/googleapis/release-please): entries are generated from Conventional Commits and published via release PRs. The entries below this note are the historical Ruby-era changelog, preserved for reference.

## [1.0.0](https://github.com/jordangarrison/hubctl/compare/hubctl-v0.4.0...hubctl-v1.0.0) (2026-09-11)


### ⚠ BREAKING CHANGES

* remove ruby implementation

### Features

* add homepage URL to gemspec ([585ae5d](https://github.com/jordangarrison/hubctl/commit/585ae5dd24cd61be661d5c4d723b6bef13bb8c7a))
* **auth:** auth command ([c52d2f5](https://github.com/jordangarrison/hubctl/commit/c52d2f52b57bb3a4306f4ba635227a965de5cdda))
* **auth:** auth status service ([aae2040](https://github.com/jordangarrison/hubctl/commit/aae2040c35128d362e12d4d377c1ac01fb0dfc0d))
* **build:** bun compile script and version constant ([f27a403](https://github.com/jordangarrison/hubctl/commit/f27a403ffef32f2025fccb48941bc819c6d5a50e))
* **cli:** global options and mode wiring ([a6fbac5](https://github.com/jordangarrison/hubctl/commit/a6fbac5db209b102055838275f4da52e81e3bc81))
* **cli:** main entrypoint and bin shim ([9856cf0](https://github.com/jordangarrison/hubctl/commit/9856cf0bd663a0be88fc7c1dc82e0ce4d6c7542b))
* **cli:** root command tree and version ([84803be](https://github.com/jordangarrison/hubctl/commit/84803be96ecf4142be5e00de2c66b1b6e22da36a))
* **config:** add the config command group (get/set/list/init/path) ([75ee4f9](https://github.com/jordangarrison/hubctl/commit/75ee4f92e5afed1097ff2a4129f9e4c60f6ee08c))
* **config:** config service with token/org resolution ([fd2058a](https://github.com/jordangarrison/hubctl/commit/fd2058af6d759343943fd6df97e9b756df091c0a))
* **config:** expose configPath on the Config service ([241c15a](https://github.com/jordangarrison/hubctl/commit/241c15ab258f64ce98f15e0e7d8de4e04847ff74))
* **config:** parse the config file through the effectful decode helper ([53071a4](https://github.com/jordangarrison/hubctl/commit/53071a448382324a8fb0288d9a7b5e5b6b5c7c0c))
* enable remote execution via nix run github:jordangarrison/hubctl ([af3aa13](https://github.com/jordangarrison/hubctl/commit/af3aa135ac331dc488a6811747a64c5c04d54e3f))
* **enterprise:** add comprehensive GitHub Enterprise management ([cbfad1a](https://github.com/jordangarrison/hubctl/commit/cbfad1a0a7ada75a1bd147ca4bc5f53eae32e8ea))
* **enterprise:** audit-log ([1b0b12c](https://github.com/jordangarrison/hubctl/commit/1b0b12c3fcd8f1037f91db15dd4c6250f2059879))
* **enterprise:** billing ([9fccad9](https://github.com/jordangarrison/hubctl/commit/9fccad98bf93e38ece32d29758a604c3d2e0cd01))
* **enterprise:** licenses ([abe7196](https://github.com/jordangarrison/hubctl/commit/abe7196eb236cf0798b13cf12e3cd9fbdb43f7c0))
* **enterprise:** members ([8b543ff](https://github.com/jordangarrison/hubctl/commit/8b543ff7a5bd82ffa5604075a8c2b388c69ac1dc))
* **enterprise:** orgs ([6468adc](https://github.com/jordangarrison/hubctl/commit/6468adcd017a4a452ff3c7cbe8d5ef2447c948fa))
* **enterprise:** owners ([df4e26e](https://github.com/jordangarrison/hubctl/commit/df4e26e97e33b333311d97a772614a332465c715))
* **enterprise:** security-analysis ([ce3bcd6](https://github.com/jordangarrison/hubctl/commit/ce3bcd66b6768b04f7ada64402fe1d0968efecbe))
* **enterprise:** show ([5742e4f](https://github.com/jordangarrison/hubctl/commit/5742e4fe2abbe810eb654bb14f0ebdfb3289fe5d))
* **enterprise:** sso ([75bcd37](https://github.com/jordangarrison/hubctl/commit/75bcd3744265cda518b6e405fde49bd6c120ff1c))
* **enterprise:** stats ([20c4f50](https://github.com/jordangarrison/hubctl/commit/20c4f50301665efa87c180275bbe8760f8f7de18))
* **github:** admit DecodeError into the GithubError union ([26f1737](https://github.com/jordangarrison/hubctl/commit/26f1737a3bc392711a6afd2129be1517264d9de9))
* **github:** name the missing OAuth scope in the ForbiddenError fix ([8d8ab6b](https://github.com/jordangarrison/hubctl/commit/8d8ab6b2db62f621ffeaa996b9e3ebb2a4860f23))
* **github:** Octokit-backed Github service with pagination ([de26f88](https://github.com/jordangarrison/hubctl/commit/de26f886618654567a288836fe7076d0ccd1baf3))
* **github:** typed error ADT and Octokit error mapping ([aae0d5f](https://github.com/jordangarrison/hubctl/commit/aae0d5f105d9df87ca81f1e82fbf985065675e9b))
* improve team member and organization invitation functionality ([602ea6e](https://github.com/jordangarrison/hubctl/commit/602ea6e8685a77ff4bfb6f43f82ff82885e42051))
* initial commit with format flag fixes and git ignore ([762f649](https://github.com/jordangarrison/hubctl/commit/762f6497971896564b573dfc6f6e49a55fcaed4c))
* **orgs,teams:** add orgs invite and teams repo-access commands ([0858149](https://github.com/jordangarrison/hubctl/commit/0858149b42f22fc6770dd7fe8cb9c642319c843f))
* **orgs,teams:** add orgs invite and teams repo-access commands ([fb7476f](https://github.com/jordangarrison/hubctl/commit/fb7476fa0a813d3a71bcbe2eac7fbbb797607516))
* **orgs:** invite ([c825479](https://github.com/jordangarrison/hubctl/commit/c82547983eff5b6f3060c2d7b70ba544b5598476))
* **orgs:** list ([9e8b786](https://github.com/jordangarrison/hubctl/commit/9e8b786664a5770c00ec007270d6c608e81c08be))
* **orgs:** members ([92648cc](https://github.com/jordangarrison/hubctl/commit/92648cc595e6680852f8873df89cb3e31598c86c))
* **orgs:** remove ([3983cd5](https://github.com/jordangarrison/hubctl/commit/3983cd5ce9b6662acbcdf5677cb0ccdaabc3d7eb))
* **orgs:** repos / teams / info ([1bdd40e](https://github.com/jordangarrison/hubctl/commit/1bdd40ee66566d1b645311ae07114c0b7094a1f2))
* **orgs:** show ([6127171](https://github.com/jordangarrison/hubctl/commit/612717181596d1e3af34449c3a9fac0afc249c26))
* **output:** add JSON envelope type and builders ([e783cd4](https://github.com/jordangarrison/hubctl/commit/e783cd452e0ca8538d9f99d9595928edd8421b7d))
* **output:** add output mode resolution ([e841afc](https://github.com/jordangarrison/hubctl/commit/e841afc80c4337f6799c170c414f64e39891e89f))
* **output:** add Output service with json and pretty renderers ([f0e6ead](https://github.com/jordangarrison/hubctl/commit/f0e6ead9eb9f63a4f405bf8acce746f6f76ac8d6))
* **output:** NDJSON streaming with terminal envelope ([810362e](https://github.com/jordangarrison/hubctl/commit/810362e8b9040f24748b9442a539326e5f8f253f))
* **output:** truncate large result lists ([d22b28c](https://github.com/jordangarrison/hubctl/commit/d22b28c2c2bc460bf34723fbeab2bab3a9cab241))
* **repos:** archive ([8812d6c](https://github.com/jordangarrison/hubctl/commit/8812d6c3a0d67ebfee260e194684dc19b6d1ecc9))
* **repos:** clone ([9c0d7ae](https://github.com/jordangarrison/hubctl/commit/9c0d7ae95c2b9dd2000a0ba25251ed9bc0fc3470))
* **repos:** create ([c259087](https://github.com/jordangarrison/hubctl/commit/c2590877346dd75e3393643fec097ff72cd33962))
* **repos:** list ([5bebeb3](https://github.com/jordangarrison/hubctl/commit/5bebeb3a0d19de1505fcb2acd6dabf15432b0340))
* **repos:** show ([7fd3943](https://github.com/jordangarrison/hubctl/commit/7fd39439410ca59b7ae016f1dad407537781eb20))
* **repos:** topics ([438e18d](https://github.com/jordangarrison/hubctl/commit/438e18d036ade3e47e7fcfb7fe790077c40a05d2))
* **schema:** add decode helper that fails into the typed E channel ([dd88a4b](https://github.com/jordangarrison/hubctl/commit/dd88a4be6f39fc2c957f05fa94e2dcda326f1ebf))
* **scripts:** interactive REPL runtime harness ([578105b](https://github.com/jordangarrison/hubctl/commit/578105b2da1ff6dc4d84f5768274086e4066ff1d))
* **services:** harden all GitHub payload decodes into ok:false envelopes ([ad9a3ad](https://github.com/jordangarrison/hubctl/commit/ad9a3ad479a30b5f8a3dd56be49a52b8f741564c))
* **teams:** add ([d938691](https://github.com/jordangarrison/hubctl/commit/d938691c8edda37f66aaaf1b0489b80e25413f98))
* **teams:** create ([1104794](https://github.com/jordangarrison/hubctl/commit/11047945368d10b872e058a894527bb1db8d75ae))
* **teams:** list ([c368be2](https://github.com/jordangarrison/hubctl/commit/c368be2f187b75ad19d332f0e911aa63b9669c35))
* **teams:** members ([c99b9fb](https://github.com/jordangarrison/hubctl/commit/c99b9fb8f327b315a91a738dff07a641b73eed0c))
* **teams:** remove ([d61b553](https://github.com/jordangarrison/hubctl/commit/d61b5539e4454030e13c61966b6e112da4ff7c09))
* **teams:** show ([f1af02f](https://github.com/jordangarrison/hubctl/commit/f1af02fe40a7a46a3d48fb4d4dfb8ba3eefce98c))
* **users:** show, whoami, list, invite, remove command group ([931eedb](https://github.com/jordangarrison/hubctl/commit/931eedb8cf454a5662611e635d296c58922b0895))


### Bug Fixes

* add arm64-darwin platform support and build dependencies ([81ff137](https://github.com/jordangarrison/hubctl/commit/81ff137ba7ff37840014917b580b3e21cad3fc67))
* **cli:** --org falls back to GITHUB_ORG env and default_org config ([acb1df2](https://github.com/jordangarrison/hubctl/commit/acb1df2e03f6cf700ecaca14c923846f3b01fc3e))
* **cli:** honor --json/--pretty/--no-color instead of erroring to help ([8f81a76](https://github.com/jordangarrison/hubctl/commit/8f81a769c73295b5c1a19f3833ad89c27e30cedb))
* enterprise billing command output formatting ([8a1d0e4](https://github.com/jordangarrison/hubctl/commit/8a1d0e4e2bd445dfeac683f3f43f6a1b078e64e3))
* **enterprise:** billing pretty/flatten path ([d06f1cf](https://github.com/jordangarrison/hubctl/commit/d06f1cf0f2299686146b4afcbbd63f19705b9fd9))
* **enterprise:** bound audit-log to one page + surface the next cursor ([57af419](https://github.com/jordangarrison/hubctl/commit/57af419b4c5e509deb4af9803add405c004fc08a))
* **enterprise:** implement GitHub Enterprise Cloud API compatibility ([4dedc8d](https://github.com/jordangarrison/hubctl/commit/4dedc8d2756b66c961872f26c162c09bb18ab450))
* **enterprise:** read audit-log @timestamp/_document_id wire keys ([433fec9](https://github.com/jordangarrison/hubctl/commit/433fec9310f1f751a0bf54b35fa864811258a1f7))
* **enterprise:** stats report shape ([62496ae](https://github.com/jordangarrison/hubctl/commit/62496aecd1ec10af3607eb9a3a25254718cc4cb3))
* **nix:** resolve Ruby installation and shared library errors ([94a2027](https://github.com/jordangarrison/hubctl/commit/94a202790f57c6a2f9d9af99dbc6b96618be1d1d))
* **orgs:** tolerate fields absent from list/summary endpoints ([95ae480](https://github.com/jordangarrison/hubctl/commit/95ae4806fbd0b1a71bfb46569ca996d788104d41))
* **output:** --no-color no longer forces json mode ([c2df022](https://github.com/jordangarrison/hubctl/commit/c2df0229d38fa86f0d56994b3fdd28912f4323f7))
* **repos:** clone reports failure on non-zero git exit ([12ead66](https://github.com/jordangarrison/hubctl/commit/12ead667350776a13975edfacb861711f15475bc))
* **teams:** make list members_count/repos_count optional ([8dad6fd](https://github.com/jordangarrison/hubctl/commit/8dad6fdffaa664adf20e47d2fc73d39fb719d4f2))
* update email address in gemspec ([42b945c](https://github.com/jordangarrison/hubctl/commit/42b945c387ff430430e67544c545d0595d0e29e5))
* **users:** invite surfaces role and inviter ([65cd846](https://github.com/jordangarrison/hubctl/commit/65cd846bdecca1b923b41813398a809d63c5a6f9))


### Code Refactoring

* remove ruby implementation ([5998635](https://github.com/jordangarrison/hubctl/commit/5998635e4079dd5ef2203ff518edc163482e0095))

## [Unreleased]

### ⚠ BREAKING CHANGES

- **Complete rewrite in Bun + TypeScript + Effect v4.** `hubctl` has been reimplemented from the ground up. The previous Ruby/Thor implementation has been removed. The TypeScript CLI is at full feature parity (minus the stubbed `server` command).
- **Agent-first JSON envelope output by default.** Every command now emits a structured JSON envelope (`{ ok, command, result, next_actions, error, fix }`) when piped or non-interactive, with an automatic human-friendly `--pretty` rendering at a TTY. The Ruby `--format table|json|list` flag has been **removed** — the envelope subsumes it (see ADR-000002).

### Added

- **JSON envelope contract** — a single `Schema`-validated output shape for every command, with `next_actions` (HATEOAS follow-up command templates), plain-language `fix` remediation on errors, and the root command emitting the full command tree as JSON for discovery.
- **Dual-mode output** — automatic mode resolution (`--json` > `--pretty` > `NO_COLOR`/`CI`/non-TTY → json > TTY → pretty); `--no-color` disables color only.
- **NDJSON streaming** for long operations (e.g. `enterprise audit-log`), with the last line always the standard envelope.
- **Result truncation** (~50 items, `truncated: true` + `count`) for agent context-window discipline.
- **Typed error ADT** (`AuthError`, `NotFoundError`, `ForbiddenError`, `RateLimitError`, `ValidationError`) mapped from Octokit statuses into `error.code`/`fix`.
- **Vitest + `@effect/vitest`** test stack with a network-free `FakeGithub` layer and a compiled-binary e2e smoke suite (see TESTING.md).

### Changed

- **Distribution** — `hubctl` now ships as a Bun-compiled standalone binary (`bun build --compile`, per-target `linux-x64`/`darwin-arm64` artifacts) plus a rewritten Nix flake whose `packages.default` is a Bun wrapper over the app. The Ruby gem packaging (`gemset.nix`, `*.gemspec`, `Gemfile`) has been removed.
- **Toolchain** — Bun, `tsgo`, oxlint/oxfmt, `@effect/language-service`, ast-grep, and a `bun run validate` gate replace the RSpec/RuboCop/gem toolchain.

### Removed

- The entire Ruby implementation (`lib/`, `spec/`, `Gemfile*`, `gemset.nix`, `*.gemspec`, `Rakefile`, `.rubocop*`).
- The `--format` output flag and the stubbed `server` command.

## [0.3.1] - 2025-01-27

### Changed

- **Code quality improvements** - Comprehensive RuboCop compliance fixes including style, complexity, and maintainability enhancements
- **Method refactoring** - Reduced ABC complexity and method lengths in GitHubClient for better maintainability
- **Documentation** - Added class-level documentation for GitHubClient
- **Nix packaging** - Fixed flake.nix formatting and nokogiri dependency reference

### Fixed

- **Style compliance** - Resolved 41 RuboCop offenses including guard clauses, string literals, and line length violations
- **Code complexity** - Refactored enterprise_members, enterprise_owners, and handle_api_error methods to reduce cyclomatic complexity
- **Error handling** - Improved method extraction and single responsibility adherence

## [0.3.0] - 2025-07-28

### Added

- **Username support for organization invitations** - `hubctl users invite` now accepts both email addresses and GitHub usernames
- **Direct team member invitations** - Users can now be added to teams directly without requiring prior organization membership
- **Automatic organization invitations** - Adding users to teams automatically invites them to the organization if needed

### Changed

- **Team membership API** - Switched from legacy team member endpoint to modern org-based membership endpoint
- **CLI help text** - Updated `users invite` command description to reflect email/username support
- **Error handling** - Improved error message extraction for GitHub API responses with nil error messages

### Fixed

- **Team member addition workflow** - Resolved "User isn't a member of this organization" error when adding new users to teams
- **Empty error messages** - Fixed issue where GitHub API errors with nil messages would display empty error text
- **Invitation method compatibility** - Brought hubctl team management functionality in line with ghadmin behavior

### Technical Details

- Updated `invite_user_to_org` method to automatically detect email vs username and handle user ID lookup
- Migrated `add_team_member` to use `PUT /orgs/{org}/teams/{team_slug}/memberships/{username}` endpoint
- Enhanced error handling for `Octokit::UnprocessableEntity` errors with improved message extraction
- Added automatic team info lookup to determine organization and team slug for API calls

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
