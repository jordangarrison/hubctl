require 'thor'

module Hubctl
  class CLI < Thor
    class_option :format, type: :string, default: 'table',
                 desc: 'Output format (table, json, list)', enum: %w[table json list]
    class_option :no_color, type: :boolean, default: false, desc: 'Disable colored output'
    class_option :yes, type: :boolean, default: false, desc: 'Skip confirmation prompts'

    def self.exit_on_failure?
      true
    end

    desc 'version', 'Show hubctl version'
    def version
      puts "hubctl #{Hubctl::VERSION}"
      puts "Ruby #{RUBY_VERSION}"

      # Show authentication status if possible
      begin
        client = GitHubClient.new
        if client.authenticated?
          user = client.current_user
          puts "Authenticated as: #{user[:login]} (#{user[:name]})"
        else
          puts "Not authenticated - set GITHUB_TOKEN or run 'hubctl config init'"
        end
      rescue
        puts "Authentication status unknown"
      end
    end

    desc 'auth', 'Check GitHub authentication status'
    def auth
      formatter = Formatter.new(format: options[:format], color: !options[:no_color])

      begin
        client = GitHubClient.new

        if client.authenticated?
          user = client.current_user
          rate_limit = client.rate_limit

          formatter.success("Authenticated successfully!")
          formatter.info("User: #{user[:login]} (#{user[:name]})")
          formatter.info("Email: #{user[:email]}") if user[:email]
          formatter.info("Plan: #{user[:plan] ? user[:plan][:name] : 'unknown'}")
          formatter.info("Rate limit remaining: #{rate_limit[:remaining]}/#{rate_limit[:limit]}")
          formatter.info("Rate limit resets at: #{Time.at(rate_limit[:resets_at])}")

          # Note about token permissions for team operations
          formatter.info("Note: Team operations require 'read:org' or 'admin:org' token scopes")
        else
          formatter.error("Authentication failed!")
          formatter.info("You need to configure your GitHub token to use hubctl.")
          puts

          prompt = TTY::Prompt.new
          choice = prompt.select("How would you like to set up authentication?", [
            { name: "Run interactive setup wizard (recommended)", value: :wizard },
            { name: "Set environment variable (GITHUB_TOKEN=...)", value: :env },
            { name: "Manual configuration file setup", value: :manual }
          ])

          case choice
          when :wizard
            formatter.info("Starting interactive setup...")
            puts
            # Create a temporary ConfigCLI instance to run the wizard
            config_cli = ConfigCLI.new
            config_cli.options = Thor::CoreExt::HashWithIndifferentAccess.new({ interactive: true, force: true })
            begin
              config_cli.init
            rescue TTY::Reader::InputInterrupt
              puts "\nSetup cancelled."
              exit 1
            end
          when :env
            formatter.info("Set your GitHub token as an environment variable:")
            formatter.info("  export GITHUB_TOKEN=your_personal_access_token")
            formatter.info("\nCreate a token at: https://github.com/settings/tokens")
            formatter.info("Required scopes: repo, user, read:org, admin:org")
          when :manual
            formatter.info("Set your GitHub token using:")
            formatter.info("  hubctl config set github_token your_token")
            formatter.info("\nOr edit the config file directly at:")
            formatter.info("  #{Config::CONFIG_FILE}")
          end
          exit 1
        end
      rescue GitHubClient::AuthenticationError => e
        formatter.error(e.message)
        exit 1
      rescue => e
        formatter.error("Unexpected error: #{e.message}")
        exit 1
      end
    end

    desc 'config SUBCOMMAND ...ARGS', 'Manage configuration'
    subcommand 'config', ConfigCLI

    desc 'users SUBCOMMAND ...ARGS', 'Manage GitHub users'
    subcommand 'users', Users

    desc 'teams SUBCOMMAND ...ARGS', 'Manage GitHub teams'
    subcommand 'teams', Teams

    desc 'repos SUBCOMMAND ...ARGS', 'Manage GitHub repositories'
    subcommand 'repos', Repos

    desc 'orgs SUBCOMMAND ...ARGS', 'Manage GitHub organizations'
    subcommand 'orgs', Orgs

    desc 'enterprise SUBCOMMAND ...ARGS', 'Manage GitHub Enterprise'
    subcommand 'enterprise', Enterprise

    desc 'server', 'Start hubctl in server mode'
    method_option :port, type: :numeric, default: 3000, desc: 'Port to run server on'
    method_option :host, type: :string, default: '0.0.0.0', desc: 'Host to bind server to'
    def server
      formatter = Formatter.new(format: options[:format], color: !options[:no_color])

      formatter.info("🚀 Starting hubctl server on #{options[:host]}:#{options[:port]}...")
      formatter.warning("Server mode is not implemented yet!")
      formatter.info("This would start a web interface for hubctl")
      formatter.info("Features planned:")
      formatter.info("  • Web-based GitHub administration")
      formatter.info("  • REST API endpoints")
      formatter.info("  • Real-time organization insights")
      formatter.info("  • Bulk operations interface")
    end

    private

    def github_token
      ENV['GITHUB_TOKEN'] || Config.get('github_token') || begin
        warn 'Warning: No GitHub token found in environment or config'
        nil
      end
    end

    def default_org
      ENV['GITHUB_ORG'] || Config.get('default_org')
    end
  end
end
