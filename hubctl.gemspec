Gem::Specification.new do |spec|
  spec.name          = "hubctl"
  spec.version       = "0.2.0"
  spec.authors       = ["Jordan Garrison"]
  spec.email         = ["jordan@jordangarrison.dev"]

  spec.summary       = "A comprehensive CLI tool for GitHub administration including Enterprise management"
  spec.description   = "hubctl is a feature-rich CLI tool for managing GitHub users, teams, repositories, organizations, and enterprises with comprehensive billing analytics, SAML SSO management, and support for multiple output formats, interactive prompts, and comprehensive error handling."
  spec.homepage      = "https://github.com/jordangarrison/hubctl"
  spec.license       = "MIT"

  spec.required_ruby_version = ">= 3.1"

  spec.files = Dir[
    "lib/**/*",
    "bin/hubctl",
    "LICENSE",
    "README.md",
    "CHANGELOG.md",
    "TESTING.md",
    "Gemfile",
    "Gemfile.lock",
    "Rakefile",
    "docs/**/*"
  ]

  spec.bindir        = "bin"
  spec.executables   = ["hubctl"]
  spec.require_paths = ["lib"]

  # Core dependencies
  spec.add_dependency "thor", "~> 1.4"
  spec.add_dependency "octokit", "~> 8.0"

  # UI and formatting
  spec.add_dependency "tty-prompt", "~> 0.23"
  spec.add_dependency "tty-table", "~> 0.12"
  spec.add_dependency "tty-spinner", "~> 0.9"
  spec.add_dependency "pastel", "~> 0.8"

  # Output formatting
  spec.add_dependency "json", "~> 2.6"

  # Development dependencies (when used with bundler)
  spec.add_development_dependency "solargraph", "~> 0.56.1"
  spec.add_development_dependency "rubocop", "~> 1.78"
end
