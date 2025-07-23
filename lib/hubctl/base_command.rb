require 'thor'
require 'tty-prompt'
require 'tty-spinner'

module Hubctl
  class BaseCommand < Thor
    class_option :format, type: :string, default: 'table',
                 desc: 'Output format (table, json, list)', enum: %w[table json list]
    class_option :no_color, type: :boolean, default: false, desc: 'Disable colored output'

    private

    def github_client
      @github_client ||= GitHubClient.new
    end

        def formatter
      # Handle Thor subcommand option inheritance issue
      # Extract format from ARGV since parent CLI options aren't automatically inherited
      format = options[:format] || 'table'

      # Look for --format in ARGV
      if ARGV.include?('--format') && (format_index = ARGV.index('--format'))
        # Get the value after --format
        format = ARGV[format_index + 1] if format_index + 1 < ARGV.length
      elsif (format_arg = ARGV.find { |arg| arg.start_with?('--format=') })
        # Handle --format=value syntax
        format = format_arg.split('=', 2)[1]
      end

      @formatter ||= Formatter.new(
        format: format,
        color: !options[:no_color]
      )
    end

    def prompt
      @prompt ||= TTY::Prompt.new
    end

    def spinner(message)
      TTY::Spinner.new("[:spinner] #{message}", format: :dots)
    end

    def with_spinner(message)
      spin = spinner(message)
      spin.auto_spin
      result = yield
      spin.success
      result
    rescue => e
      spin.error
      raise e
    end

    def ensure_authenticated!
      return if github_client.authenticated?

      formatter.error("GitHub authentication failed!")
      formatter.info("Please set your GitHub token:")
      formatter.info("  Environment variable: export GITHUB_TOKEN=your_token")
      formatter.info("  Configuration: hubctl config set github_token your_token")
      exit 1
    end

    def handle_error(error)
      case error
      when GitHubClient::AuthenticationError
        formatter.error(error.message)
        formatter.info("Run 'hubctl config init' to set up authentication")
        exit 1
      when GitHubClient::APIError
        formatter.error(error.message)
        exit 1
      else
        formatter.error("Unexpected error: #{error.message}")
        exit 1
      end
    end

    def confirm_action(message, default: false)
      return true if options[:yes]
      prompt.yes?(message, default: default)
    end

    def default_org
      options[:org] || ENV['GITHUB_ORG'] || Config.get('default_org')
    end

    def require_org!
      return default_org if default_org

      formatter.error("Organization is required but not specified")
      formatter.info("Specify with --org=ORG or set default: hubctl config set default_org ORG")
      exit 1
    end

    def default_enterprise
      options[:enterprise] || ENV['GITHUB_ENTERPRISE'] || Config.get('default_enterprise')
    end

    def require_enterprise!
      return default_enterprise if default_enterprise

      formatter.error("Enterprise is required but not specified")
      formatter.info("Specify with --enterprise=ENTERPRISE or set default: hubctl config set default_enterprise ENTERPRISE")
      exit 1
    end
  end
end
