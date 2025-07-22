require 'thor'

module Hubctl
  class Repos < BaseCommand
    desc 'list', 'List repositories'
    method_option :org, type: :string, desc: 'Organization name'
    method_option :type, type: :string, default: 'all',
                  desc: 'Repository type', enum: %w[all public private forks sources member]
    method_option :sort, type: :string, default: 'updated',
                  desc: 'Sort repositories', enum: %w[created updated pushed full_name]
    method_option :direction, type: :string, default: 'desc',
                  desc: 'Sort direction', enum: %w[asc desc]
    def list
      ensure_authenticated!

      begin
        repos = with_spinner("Fetching repositories") do
          if options[:org]
            github_client.organization_repositories(
              options[:org],
              type: options[:type] == 'all' ? nil : options[:type],
              sort: options[:sort],
              direction: options[:direction]
            )
          else
            github_client.repositories(
              type: options[:type] == 'all' ? nil : options[:type],
              sort: options[:sort],
              direction: options[:direction]
            )
          end
        end

        # Transform data for display
        repo_data = repos.map do |repo|
          {
            name: repo[:name],
            full_name: repo[:full_name],
            private: repo[:private],
            description: repo[:description] || '-',
            language: repo[:language] || '-',
            stars: repo[:stargazers_count],
            forks: repo[:forks_count],
            updated: repo[:updated_at]
          }
        end

        formatter.output(repo_data, headers: %w[name private description language stars forks updated])

        source = options[:org] ? "organization #{options[:org]}" : "your account"
        formatter.success("Found #{repos.length} repositories in #{source}")
      rescue => e
        handle_error(e)
      end
    end

    desc 'show REPO', 'Show repository details'
    def show(repo)
      ensure_authenticated!

      begin
        repository = with_spinner("Fetching repository details") do
          github_client.repository(repo)
        end

        repo_details = {
          name: repository[:name],
          full_name: repository[:full_name],
          description: repository[:description],
          private: repository[:private],
          fork: repository[:fork],
          language: repository[:language],
          size: "#{repository[:size]} KB",
          stars: repository[:stargazers_count],
          watchers: repository[:watchers_count],
          forks: repository[:forks_count],
          open_issues: repository[:open_issues_count],
          default_branch: repository[:default_branch],
          created_at: repository[:created_at],
          updated_at: repository[:updated_at],
          pushed_at: repository[:pushed_at],
          clone_url: repository[:clone_url],
          ssh_url: repository[:ssh_url],
          html_url: repository[:html_url]
        }

        formatter.output(repo_details)
      rescue => e
        handle_error(e)
      end
    end

    desc 'create NAME', 'Create a new repository'
    method_option :org, type: :string, desc: 'Organization name'
    method_option :description, type: :string, desc: 'Repository description'
    method_option :private, type: :boolean, default: false, desc: 'Make repository private'
    method_option :init, type: :boolean, default: true, desc: 'Initialize with README'
    method_option :gitignore, type: :string, desc: 'Gitignore template'
    method_option :license, type: :string, desc: 'License template'
    def create(name)
      ensure_authenticated!

      create_options = {
        description: options[:description],
        private: options[:private],
        auto_init: options[:init]
      }
      create_options[:gitignore_template] = options[:gitignore] if options[:gitignore]
      create_options[:license_template] = options[:license] if options[:license]

      begin
        if options[:org]
          create_options[:org] = options[:org]
          repo = with_spinner("Creating repository in organization") do
            github_client.create_repository(name, create_options)
          end
        else
          repo = with_spinner("Creating personal repository") do
            github_client.create_repository(name, create_options)
          end
        end

        formatter.success("Repository created: #{repo[:full_name]}")
        formatter.info("Clone URL: #{repo[:clone_url]}")
        formatter.info("HTML URL: #{repo[:html_url]}")
      rescue => e
        handle_error(e)
      end
    end

    desc 'clone REPO', 'Clone a repository'
    method_option :path, type: :string, desc: 'Local path to clone to'
    method_option :depth, type: :numeric, desc: 'Create a shallow clone with history truncated'
    def clone(repo)
      ensure_authenticated!

      begin
        repository = with_spinner("Fetching repository details") do
          github_client.repository(repo)
        end

        clone_url = repository[:clone_url]
        target_path = options[:path] || File.basename(repo, '.git')

        clone_cmd = "git clone"
        clone_cmd += " --depth #{options[:depth]}" if options[:depth]
        clone_cmd += " #{clone_url}"
        clone_cmd += " #{target_path}" if options[:path]

        formatter.info("Cloning #{repo}...")
        formatter.info("Command: #{clone_cmd}")

        if system(clone_cmd)
          formatter.success("Successfully cloned to #{target_path}")
        else
          formatter.error("Failed to clone repository")
          exit 1
        end
      rescue => e
        handle_error(e)
      end
    end

    desc 'archive REPO', 'Archive a repository'
    method_option :yes, type: :boolean, desc: 'Skip confirmation prompt'
    def archive(repo)
      ensure_authenticated!

      unless confirm_action("Are you sure you want to archive #{repo}? This cannot be undone easily.")
        formatter.info("Operation cancelled")
        return
      end

      begin
        with_spinner("Archiving repository") do
          github_client.edit_repository(repo, archived: true)
        end

        formatter.success("Successfully archived #{repo}")
        formatter.warning("Repository is now read-only")
      rescue => e
        handle_error(e)
      end
    end

    desc 'topics REPO', 'List or set repository topics'
    method_option :add, type: :array, desc: 'Topics to add'
    method_option :remove, type: :array, desc: 'Topics to remove'
    method_option :set, type: :array, desc: 'Set topics (replaces all existing)'
    def topics(repo)
      ensure_authenticated!

      begin
        if options[:add] || options[:remove] || options[:set]
          # Modify topics
          current_repo = github_client.repository(repo)
          current_topics = current_repo[:topics] || []

          if options[:set]
            new_topics = options[:set]
          else
            new_topics = current_topics.dup
            new_topics.concat(options[:add]) if options[:add]
            new_topics -= options[:remove] if options[:remove]
            new_topics.uniq!
          end

          with_spinner("Updating repository topics") do
            github_client.replace_all_topics(repo, new_topics)
          end

          formatter.success("Updated topics for #{repo}")
          formatter.info("Topics: #{new_topics.join(', ')}")
        else
          # List current topics
          repository = with_spinner("Fetching repository topics") do
            github_client.repository(repo)
          end

          topics = repository[:topics] || []
          if topics.empty?
            formatter.info("No topics set for #{repo}")
          else
            formatter.info("Topics for #{repo}:")
            formatter.output(topics.map.with_index(1) { |topic, i| [i, topic] },
                           headers: ['#', 'Topic'])
          end
        end
      rescue => e
        handle_error(e)
      end
    end
  end
end
