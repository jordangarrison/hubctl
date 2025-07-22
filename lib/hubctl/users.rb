require 'thor'

module Hubctl
  class Users < BaseCommand
    desc 'list', 'List GitHub users in organization'
    method_option :org, type: :string, desc: 'Organization name'
    method_option :role, type: :string, default: 'all', desc: 'Filter by role (all, admin, member)'
    def list
      ensure_authenticated!
      org = require_org!

      begin
        users = with_spinner("Fetching organization members") do
          github_client.organization_members(org, role: options[:role] == 'all' ? nil : options[:role])
        end

        # Transform data for display
        user_data = users.map do |user|
          {
            login: user[:login],
            id: user[:id],
            type: user[:type],
            site_admin: user[:site_admin],
            url: user[:html_url]
          }
        end

        formatter.output(user_data, headers: %w[login id type site_admin url])

        formatter.success("Found #{users.length} users in #{org}")
      rescue => e
        handle_error(e)
      end
    end

    desc 'show USER', 'Show details for a specific user'
    def show(username)
      ensure_authenticated!

      begin
        user = with_spinner("Fetching user details") do
          github_client.user(username)
        end

        user_details = {
          login: user[:login],
          name: user[:name],
          email: user[:email],
          bio: user[:bio],
          company: user[:company],
          location: user[:location],
          blog: user[:blog],
          public_repos: user[:public_repos],
          public_gists: user[:public_gists],
          followers: user[:followers],
          following: user[:following],
          created_at: user[:created_at],
          updated_at: user[:updated_at],
          url: user[:html_url]
        }

        formatter.output(user_details)
      rescue => e
        handle_error(e)
      end
    end

    desc 'invite EMAIL', 'Invite user to organization'
    method_option :org, type: :string, desc: 'Organization name'
    method_option :role, type: :string, default: 'direct_member',
                  desc: 'Role for invited user (direct_member, admin, billing_manager)'
    method_option :team_ids, type: :array, desc: 'Team IDs to add user to'
    def invite(email)
      ensure_authenticated!
      org = require_org!

      begin
        invitation_options = { role: options[:role] }
        invitation_options[:team_ids] = options[:team_ids] if options[:team_ids]

        invitation = with_spinner("Sending invitation") do
          github_client.invite_user_to_org(org, email, invitation_options)
        end

        formatter.success("Invitation sent to #{email}")
        formatter.info("Role: #{options[:role]}")
        formatter.info("Invitation ID: #{invitation[:id]}")

        if invitation[:inviter]
          formatter.info("Sent by: #{invitation[:inviter][:login]}")
        end
      rescue => e
        handle_error(e)
      end
    end

    desc 'remove USER', 'Remove user from organization'
    method_option :org, type: :string, desc: 'Organization name'
    method_option :yes, type: :boolean, desc: 'Skip confirmation prompt'
    def remove(username)
      ensure_authenticated!
      org = require_org!

      unless confirm_action("Are you sure you want to remove #{username} from #{org}?")
        formatter.info("Operation cancelled")
        return
      end

      begin
        with_spinner("Removing user from organization") do
          github_client.remove_org_member(org, username)
        end

        formatter.success("Successfully removed #{username} from #{org}")
      rescue => e
        handle_error(e)
      end
    end

    desc 'whoami', 'Show current authenticated user'
    def whoami
      ensure_authenticated!

      begin
        user = with_spinner("Fetching current user") do
          github_client.current_user
        end

        current_user_info = {
          login: user[:login],
          name: user[:name],
          email: user[:email],
          company: user[:company],
          plan: user[:plan][:name],
          private_repos: user[:owned_private_repos],
          collaborators: user[:collaborators],
          disk_usage: "#{user[:disk_usage]} KB"
        }

        formatter.output(current_user_info)
      rescue => e
        handle_error(e)
      end
    end
  end
end
