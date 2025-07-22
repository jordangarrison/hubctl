require 'thor'

module Hubctl
  class Orgs < BaseCommand
    desc 'list', 'List your organizations'
    def list
      ensure_authenticated!

      begin
        orgs = with_spinner("Fetching organizations") do
          github_client.organizations
        end

        # Transform data for display
        org_data = orgs.map do |org|
          {
            login: org[:login],
            id: org[:id],
            description: org[:description] || '-',
            public_repos: org[:public_repos],
            public_gists: org[:public_gists],
            followers: org[:followers],
            following: org[:following],
            url: org[:html_url]
          }
        end

        formatter.output(org_data, headers: %w[login description public_repos followers url])

        formatter.success("Found #{orgs.length} organizations")
      rescue => e
        handle_error(e)
      end
    end

    desc 'show ORG', 'Show organization details'
    def show(org)
      ensure_authenticated!

      begin
        organization = with_spinner("Fetching organization details") do
          github_client.organization(org)
        end

        org_details = {
          login: organization[:login],
          id: organization[:id],
          name: organization[:name],
          company: organization[:company],
          blog: organization[:blog],
          location: organization[:location],
          email: organization[:email],
          bio: organization[:bio],
          description: organization[:description],
          public_repos: organization[:public_repos],
          public_gists: organization[:public_gists],
          followers: organization[:followers],
          following: organization[:following],
          collaborators: organization[:collaborators],
          billing_email: organization[:billing_email],
          plan: organization[:plan][:name],
          private_gists: organization[:private_gists],
          total_private_repos: organization[:total_private_repos],
          owned_private_repos: organization[:owned_private_repos],
          disk_usage: "#{organization[:disk_usage]} KB",
          created_at: organization[:created_at],
          updated_at: organization[:updated_at],
          url: organization[:html_url]
        }

        formatter.output(org_details)
      rescue => e
        handle_error(e)
      end
    end

    desc 'members ORG', 'List organization members'
    method_option :role, type: :string, default: 'all', desc: 'Filter by role (all, admin, member)'
    method_option :filter, type: :string, default: 'all', desc: 'Filter members (all, 2fa_disabled)'
    def members(org)
      ensure_authenticated!

      begin
        options_hash = {}
        options_hash[:role] = options[:role] unless options[:role] == 'all'
        options_hash[:filter] = options[:filter] unless options[:filter] == 'all'

        members = with_spinner("Fetching organization members") do
          github_client.organization_members(org, options_hash)
        end

        # Transform data for display
        member_data = members.map do |member|
          {
            login: member[:login],
            id: member[:id],
            type: member[:type],
            site_admin: member[:site_admin],
            url: member[:html_url]
          }
        end

        formatter.output(member_data, headers: %w[login id type site_admin url])

        role_text = options[:role] == 'all' ? 'all roles' : options[:role]
        formatter.success("Found #{members.length} members (#{role_text}) in #{org}")
      rescue => e
        handle_error(e)
      end
    end

    desc 'repos ORG', 'List organization repositories'
    method_option :type, type: :string, default: 'all',
                  desc: 'Repository type', enum: %w[all public private forks sources member]
    method_option :sort, type: :string, default: 'updated',
                  desc: 'Sort repositories', enum: %w[created updated pushed full_name]
    def repos(org)
      ensure_authenticated!

      begin
        repos = with_spinner("Fetching organization repositories") do
          github_client.organization_repositories(
            org,
            type: options[:type] == 'all' ? nil : options[:type],
            sort: options[:sort]
          )
        end

        # Transform data for display
        repo_data = repos.map do |repo|
          {
            name: repo[:name],
            private: repo[:private],
            description: repo[:description] || '-',
            language: repo[:language] || '-',
            stars: repo[:stargazers_count],
            forks: repo[:forks_count],
            updated: repo[:updated_at]
          }
        end

        formatter.output(repo_data, headers: %w[name private description language stars forks updated])

        formatter.success("Found #{repos.length} repositories in organization #{org}")
      rescue => e
        handle_error(e)
      end
    end

    desc 'teams ORG', 'List organization teams'
    def teams(org)
      ensure_authenticated!

      begin
        teams = with_spinner("Fetching organization teams") do
          github_client.organization_teams(org)
        end

        # Transform data for display
        team_data = teams.map do |team|
          {
            name: team[:name],
            slug: team[:slug],
            description: team[:description] || '-',
            privacy: team[:privacy],
            members_count: team[:members_count],
            repos_count: team[:repos_count]
          }
        end

        formatter.output(team_data, headers: %w[name slug description privacy members_count repos_count])

        formatter.success("Found #{teams.length} teams in organization #{org}")
      rescue => e
        handle_error(e)
      end
    end

    desc 'info', 'Show authenticated user\'s organization memberships'
    def info
      ensure_authenticated!

      begin
        user = github_client.current_user
        orgs = github_client.organizations

        formatter.info("Authenticated as: #{formatter.bold(user[:login])} (#{user[:name]})")
        formatter.info("Plan: #{user[:plan][:name]}")

        if orgs.any?
          formatter.info("\nOrganization memberships:")
          orgs.each_with_index do |org, index|
            formatter.info("#{index + 1}. #{formatter.bold(org[:login])} - #{org[:description] || 'No description'}")
          end
        else
          formatter.info("No organization memberships found")
        end
      rescue => e
        handle_error(e)
      end
    end
  end
end
