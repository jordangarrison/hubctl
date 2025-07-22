require 'thor'

module Hubctl
  class Teams < BaseCommand
    desc 'list', 'List teams in organization'
    method_option :org, type: :string, desc: 'Organization name'
    def list
      ensure_authenticated!
      org = require_org!

      begin
        teams = with_spinner("Fetching organization teams") do
          github_client.organization_teams(org)
        end

        # Transform data for display
        team_data = teams.map do |team|
          {
            id: team[:id],
            name: team[:name],
            slug: team[:slug],
            description: team[:description] || '-',
            privacy: team[:privacy],
            permission: team[:permission],
            members_count: team[:members_count],
            repos_count: team[:repos_count]
          }
        end

        formatter.output(team_data, headers: %w[name slug description privacy members_count repos_count])

        formatter.success("Found #{teams.length} teams in #{org}")
      rescue => e
        handle_error(e)
      end
    end

    desc 'create NAME', 'Create a new team'
    method_option :org, type: :string, desc: 'Organization name'
    method_option :description, type: :string, desc: 'Team description'
    method_option :privacy, type: :string, default: 'closed', desc: 'Team privacy (secret, closed)'
    method_option :permission, type: :string, default: 'pull',
                  desc: 'Permission level', enum: %w[pull triage push maintain admin]
    def create(name)
      ensure_authenticated!
      org = require_org!

      begin
        team_options = {
          name: name,
          description: options[:description],
          privacy: options[:privacy],
          permission: options[:permission]
        }

        team = with_spinner("Creating team") do
          github_client.create_team(org, team_options)
        end

        formatter.success("Team created: #{team[:name]}")
        formatter.info("Team ID: #{team[:id]}")
        formatter.info("Slug: #{team[:slug]}")
        formatter.info("Privacy: #{team[:privacy]}")
        formatter.info("Permission: #{team[:permission]}")
      rescue => e
        handle_error(e)
      end
    end

    desc 'members TEAM', 'List team members'
    method_option :org, type: :string, desc: 'Organization name'
    def members(team_slug)
      ensure_authenticated!
      org = require_org!

      begin
        # First get the team by slug
        teams = github_client.organization_teams(org)
        team = teams.find { |t| t[:slug] == team_slug }

        unless team
          formatter.error("Team '#{team_slug}' not found in organization '#{org}'")
          return
        end

        members = with_spinner("Fetching team members") do
          github_client.team_members(team[:id])
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

        formatter.success("Found #{members.length} members in team #{team[:name]}")
      rescue => e
        handle_error(e)
      end
    end

    desc 'add-member TEAM USER', 'Add user to team'
    method_option :org, type: :string, desc: 'Organization name'
    method_option :role, type: :string, default: 'member', desc: 'Role (member, maintainer)'
    def add_member(team_slug, username)
      ensure_authenticated!
      org = require_org!

      begin
        # First get the team by slug
        teams = github_client.organization_teams(org)
        team = teams.find { |t| t[:slug] == team_slug }

        unless team
          formatter.error("Team '#{team_slug}' not found in organization '#{org}'")
          return
        end

        with_spinner("Adding user to team") do
          github_client.add_team_member(team[:id], username, role: options[:role])
        end

        formatter.success("Successfully added #{username} to team #{team[:name]}")
        formatter.info("Role: #{options[:role]}")
      rescue => e
        handle_error(e)
      end
    end

    desc 'remove-member TEAM USER', 'Remove user from team'
    method_option :org, type: :string, desc: 'Organization name'
    method_option :yes, type: :boolean, desc: 'Skip confirmation prompt'
    def remove_member(team_slug, username)
      ensure_authenticated!
      org = require_org!

      unless confirm_action("Are you sure you want to remove #{username} from team #{team_slug}?")
        formatter.info("Operation cancelled")
        return
      end

      begin
        # First get the team by slug
        teams = github_client.organization_teams(org)
        team = teams.find { |t| t[:slug] == team_slug }

        unless team
          formatter.error("Team '#{team_slug}' not found in organization '#{org}'")
          return
        end

        with_spinner("Removing user from team") do
          github_client.remove_team_member(team[:id], username)
        end

        formatter.success("Successfully removed #{username} from team #{team[:name]}")
      rescue => e
        handle_error(e)
      end
    end

    desc 'show TEAM', 'Show team details'
    method_option :org, type: :string, desc: 'Organization name'
    def show(team_slug)
      ensure_authenticated!
      org = require_org!

      begin
        teams = with_spinner("Fetching team details") do
          github_client.organization_teams(org)
        end

        team = teams.find { |t| t[:slug] == team_slug }

        unless team
          formatter.error("Team '#{team_slug}' not found in organization '#{org}'")
          return
        end

        team_details = {
          id: team[:id],
          name: team[:name],
          slug: team[:slug],
          description: team[:description],
          privacy: team[:privacy],
          permission: team[:permission],
          members_count: team[:members_count],
          repos_count: team[:repos_count],
          created_at: team[:created_at],
          updated_at: team[:updated_at],
          url: team[:html_url]
        }

        formatter.output(team_details)
      rescue => e
        handle_error(e)
      end
    end
  end
end
