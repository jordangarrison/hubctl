require 'thor'

module Hubctl
  class ConfigCLI < Thor
    class_option :format, type: :string, default: 'table',
                 desc: 'Output format (table, json, list)', enum: %w[table json list]
    class_option :no_color, type: :boolean, default: false, desc: 'Disable colored output'

        desc 'show', 'Show current configuration'
    def show
      # Handle Thor subcommand option inheritance issue - extract format from ARGV
      format = options[:format] || 'table'
      if ARGV.include?('--format') && (format_index = ARGV.index('--format'))
        format = ARGV[format_index + 1] if format_index + 1 < ARGV.length
      elsif (format_arg = ARGV.find { |arg| arg.start_with?('--format=') })
        format = format_arg.split('=', 2)[1]
      end

      formatter = Formatter.new(format: format, color: !options[:no_color])
      config = Config.load

      if config.empty?
        formatter.info("No configuration found. Use 'hubctl config init' to create initial config.")
      else
        formatter.output(config)
      end
    end

    desc 'init', 'Initialize configuration with interactive setup'
    method_option :interactive, type: :boolean, default: true, desc: 'Run interactive setup wizard'
    method_option :force, type: :boolean, default: false, desc: 'Overwrite existing config file'
    def init
      if File.exist?(Config::CONFIG_FILE) && !options[:force]
        puts "Configuration file already exists at #{Config::CONFIG_FILE}"
        puts "Use --force to overwrite or run 'hubctl config edit' to modify"
        return
      end

      if options[:interactive]
        run_interactive_setup
      else
        # Fallback to old behavior
        Config.save(Config.example_config)
        puts "Configuration file created at #{Config::CONFIG_FILE}"
        puts "Please edit the file to add your actual values."
      end
    end

    private

    def run_interactive_setup
      # Handle Thor subcommand option inheritance issue - extract format from ARGV
      format = options[:format] || 'table'
      if ARGV.include?('--format') && (format_index = ARGV.index('--format'))
        format = ARGV[format_index + 1] if format_index + 1 < ARGV.length
      elsif (format_arg = ARGV.find { |arg| arg.start_with?('--format=') })
        format = format_arg.split('=', 2)[1]
      end

      formatter = Formatter.new(format: format, color: !options[:no_color])
      prompt = TTY::Prompt.new

      formatter.info("Welcome to hubctl setup! Let's configure your GitHub CLI.")
      puts

      config = {}

      # Get GitHub token
      formatter.info("First, we need your GitHub personal access token.")
      formatter.info("You can create one at: https://github.com/settings/tokens")
      formatter.info("Required scopes: repo, user, read:org, admin:org")
      puts

      existing_token = ENV['GITHUB_TOKEN'] || Config.get('github_token')
      if existing_token
        formatter.info("Found existing token: #{existing_token[0..7]}...")
        use_existing = prompt.yes?("Use this token?")
        config['github_token'] = existing_token if use_existing
      end

      unless config['github_token']
        token = prompt.mask("Enter your GitHub token:")
        config['github_token'] = token if token && !token.empty?
      end

      # Test the token if provided
      if config['github_token']
        puts
        formatter.info("Testing GitHub authentication...")

        begin
          test_client = GitHubClient.new(config['github_token'])
          if test_client.authenticated?
            user = test_client.current_user
            formatter.success("✓ Authentication successful!")
            formatter.info("Logged in as: #{user[:login]} (#{user[:name]})")

            # Get organizations for default org selection
            puts
            formatter.info("Fetching your organizations...")
            orgs = test_client.organizations

            if orgs && orgs.length > 0
              formatter.success("Found #{orgs.length} organizations:")
              org_choices = orgs.map { |org| { name: "#{org[:login]} - #{org[:description] || 'No description'}", value: org[:login] } }
              org_choices << { name: "Skip - I'll set this later", value: nil }

              selected_org = prompt.select("Select default organization:", org_choices)
              config['default_org'] = selected_org if selected_org
            else
              formatter.warning("No organizations found. You can set a default organization later.")
            end

          else
            formatter.error("✗ Authentication failed. Please check your token.")
            return
          end
        rescue => e
          formatter.error("✗ Error testing token: #{e.message}")
          formatter.warning("Continuing with setup - you can test authentication later with 'hubctl auth'")
        end
      end

      # Additional optional settings
      puts
      if prompt.yes?("Configure additional settings?")
        # Output format preference
        format_choice = prompt.select("Preferred output format:", [
          { name: "Table (default)", value: "table" },
          { name: "JSON", value: "json" },
          { name: "List", value: "list" }
        ])
        config['default_format'] = format_choice if format_choice != "table"

        # Color preference
        unless prompt.yes?("Enable colored output?", default: true)
          config['no_color'] = true
        end
      end

      # Save configuration
      puts
      formatter.info("Saving configuration to #{Config::CONFIG_FILE}")
      Config.save(config)
      formatter.success("✓ Configuration saved successfully!")

      puts
      formatter.info("Setup complete! You can now use hubctl commands.")
      formatter.info("Try: hubctl auth")
      formatter.info("     hubctl orgs list")
      formatter.info("     hubctl teams list")
    end

        desc 'get KEY', 'Get a configuration value'
    def get(key)
      # Handle Thor subcommand option inheritance issue - extract format from ARGV
      format = options[:format] || 'table'
      if ARGV.include?('--format') && (format_index = ARGV.index('--format'))
        format = ARGV[format_index + 1] if format_index + 1 < ARGV.length
      elsif (format_arg = ARGV.find { |arg| arg.start_with?('--format=') })
        format = format_arg.split('=', 2)[1]
      end

      formatter = Formatter.new(format: format, color: !options[:no_color])
      value = Config.get(key)

      if value.nil?
        formatter.warning("No value found for key: #{key}")
      else
        formatter.output({ key => value })
      end
    end

    desc 'set KEY VALUE', 'Set a configuration value'
    def set(key, value)
      Config.set(key, value)
      puts "Set #{key} = #{value}"
    end

    desc 'path', 'Show configuration file path'
    def path
      puts Config::CONFIG_FILE
    end

    desc 'edit', 'Open configuration file in editor'
    def edit
      editor = ENV['EDITOR'] || 'nano'
      system("#{editor} #{Config::CONFIG_FILE}")
    end
  end
end
