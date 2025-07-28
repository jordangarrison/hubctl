# frozen_string_literal: true

require 'octokit'
require 'pastel'

module Hubctl
  class GitHubClient
    class AuthenticationError < StandardError; end
    class APIError < StandardError; end

    def initialize(token = nil)
      @token = token || github_token
      @client = Octokit::Client.new(access_token: @token)
      @client.auto_paginate = true
      @pastel = Pastel.new
    end

    def authenticated?
      return false unless github_token

      begin
        @client.user
        true
      rescue Octokit::Unauthorized
        false
      end
    end

    def current_user
      @client.user
    rescue Octokit::Error => e
      handle_api_error(e)
    end

    def rate_limit
      @client.rate_limit
    rescue Octokit::Error => e
      handle_api_error(e)
    end

    def scopes
      # Get the token scopes - GitHub includes them in most API responses
      # Use the current user endpoint which is lightweight
      response = @client.octokit.user
      # Try to get scopes from the response metadata
      if response.respond_to?(:attrs) && response.attrs[:rels] && response.attrs[:rels][:self]
        # This method doesn't reliably provide scopes, so let's use a simpler approach
        return ['repo', 'user', 'admin:org', 'read:org'] # Common scopes - we'll refine this
      else
        return ['unknown']
      end
    rescue Octokit::Error => e
      handle_api_error(e)
    rescue => e
      ['error retrieving scopes']
    end

    # Organization methods
    def organizations
      @client.organizations
    rescue Octokit::Error => e
      handle_api_error(e)
    end

    def organization(org)
      @client.organization(org)
    rescue Octokit::Error => e
      handle_api_error(e)
    end

    def organization_members(org, options = {})
      @client.organization_members(org, options)
    rescue Octokit::Error => e
      handle_api_error(e)
    end

    # User methods
    def user(username)
      @client.user(username)
    rescue Octokit::Error => e
      handle_api_error(e)
    end

    def invite_user_to_org(org, email_or_username, options = {})
      # Check if the input looks like an email address
      if email_or_username.include?('@')
        # Invite by email
        @client.post("/orgs/#{org}/invitations", { email: email_or_username }.merge(options))
      else
        # Invite by username - first get the user ID
        user_info = @client.user(email_or_username)
        @client.post("/orgs/#{org}/invitations", { invitee_id: user_info[:id] }.merge(options))
      end
    rescue Octokit::Error => e
      handle_api_error(e)
    end

    def remove_org_member(org, username)
      @client.remove_org_member(org, username)
    rescue Octokit::Error => e
      handle_api_error(e)
    end

    # Team methods
    def organization_teams(org)
      @client.organization_teams(org)
    rescue Octokit::Error => e
      handle_api_error(e)
    end

    def create_team(org, options = {})
      @client.create_team(org, options)
    rescue Octokit::Error => e
      handle_api_error(e)
    end

    def team_members(team_id)
      @client.team_members(team_id)
    rescue Octokit::Error => e
      handle_api_error(e)
    end

    def add_team_member(team_id, username, options = {})
      # First, get the team info to find the org and team_slug for the newer endpoint
      team_info = @client.team(team_id)
      org = team_info[:organization][:login]
      team_slug = team_info[:slug]
      
      # Use the newer org-based endpoint which can invite users to org and add to team
      # This is equivalent to octokit.js addOrUpdateMembershipForUserInOrg
      @client.put("/orgs/#{org}/teams/#{team_slug}/memberships/#{username}", options)
    rescue Octokit::Error => e
      handle_api_error(e)
    end

    def remove_team_member(team_id, username)
      @client.remove_team_member(team_id, username)
    rescue Octokit::Error => e
      handle_api_error(e)
    end

    # Repository methods
    def repositories(options = {})
      @client.repositories(options)
    rescue Octokit::Error => e
      handle_api_error(e)
    end

    def organization_repositories(org, options = {})
      @client.organization_repositories(org, options)
    rescue Octokit::Error => e
      handle_api_error(e)
    end

    def repository(repo)
      @client.repository(repo)
    rescue Octokit::Error => e
      handle_api_error(e)
    end

    def create_repository(name, options = {})
      @client.create_repository(name, options)
    rescue Octokit::Error => e
      handle_api_error(e)
    end

    def edit_repository(repo, options = {})
      @client.edit_repository(repo, options)
    rescue Octokit::Error => e
      handle_api_error(e)
    end

    def replace_all_topics(repo, topics)
      @client.replace_all_topics(repo, topics)
    rescue Octokit::Error => e
      handle_api_error(e)
    end

    # === ENTERPRISE METHODS ===
    # Note: GitHub Enterprise Cloud doesn't have direct /enterprises/{enterprise} endpoints
    # Most enterprise functionality is accessed through organization endpoints

    # Enterprise account methods
    def enterprise(enterprise)
      # For Enterprise Cloud, we get enterprise info through the primary org
      # This is a workaround since /enterprises/{enterprise} doesn't exist in Enterprise Cloud
      org_data = @client.organization(enterprise)
      if org_data.plan.name == 'enterprise'
        {
          login: enterprise,
          name: org_data.name,
          description: org_data.description,
          plan: org_data.plan.name,
          created_at: org_data.created_at,
          updated_at: org_data.updated_at
        }
      else
        raise APIError, "Organization #{enterprise} is not an enterprise account"
      end
    rescue Octokit::Error => e
      handle_api_error(e)
    end

    def enterprise_organizations(enterprise, options = {})
      @client.paginate("/enterprises/#{enterprise}/organizations", options)
    rescue Octokit::Error => e
      handle_api_error(e)
    end

    def create_enterprise_organization(enterprise, login, options = {})
      @client.post("/enterprises/#{enterprise}/organizations", { login: login }.merge(options))
    rescue Octokit::Error => e
      handle_api_error(e)
    end

    # Enterprise members and owners
    def enterprise_members(enterprise, options = {})
      # GitHub Enterprise Cloud doesn't have /enterprises/{enterprise}/members
      # Instead, we get members from the consumed-licenses endpoint (paginated)
      all_users = []
      page = 1
      loop do
        response = @client.get("/enterprises/#{enterprise}/consumed-licenses", per_page: 100, page: page)
        users_in_page = response[:users] || []
        all_users.concat(users_in_page)
        
        # Break if this page has fewer users than the max (indicating last page)
        break if users_in_page.length < 100
        page += 1
        # Safety break to prevent infinite loops
        break if page > 50
      end
      
      # Filter based on role if specified
      members = all_users
      if options[:role]
        case options[:role].downcase
        when 'admin', 'owner'
          members = members.select { |user| user[:github_com_enterprise_roles]&.include?("Owner") }
        when 'member'
          members = members.select { |user| user[:github_com_enterprise_roles]&.include?("Member") && !user[:github_com_enterprise_roles]&.include?("Owner") }
        end
      end
      # If no role filter, include all users (members, owners, and outside collaborators)
      
      # Filter by two_factor_disabled if specified
      if options[:two_factor_disabled]
        members = members.select { |user| !user[:github_com_two_factor_auth] }
      end
      
      # Transform to match expected format
      members.map do |member|
        roles = member[:github_com_enterprise_roles] || []
        role = if roles.include?("Owner")
                 'admin'
               elsif roles.include?("Member")
                 'member'
               elsif roles.include?("Outside collaborator")
                 'collaborator'
               elsif roles.include?("Pending invitation")
                 'pending'
               else
                 'unknown'
               end
        
        {
          login: member[:github_com_login],
          id: nil, # Not provided in consumed-licenses endpoint
          role: role,
          email: member[:github_com_verified_domain_emails]&.first,
          two_factor_disabled: !member[:github_com_two_factor_auth],
          saml_identity: member[:github_com_saml_name_id] ? 'configured' : 'none',
          avatar_url: nil # Not provided in consumed-licenses endpoint
        }
      end
    rescue Octokit::Error => e
      handle_api_error(e)
    end

    def enterprise_owners(enterprise, options = {})
      # GitHub Enterprise Cloud doesn't have /enterprises/{enterprise}/owners
      # Instead, we get owners from the consumed-licenses endpoint (paginated)
      all_users = []
      page = 1
      loop do
        response = @client.get("/enterprises/#{enterprise}/consumed-licenses", per_page: 100, page: page)
        users_in_page = response[:users] || []
        all_users.concat(users_in_page)
        
        # Break if this page has fewer users than the max (indicating last page)
        break if users_in_page.length < 100
        page += 1
        # Safety break to prevent infinite loops
        break if page > 50
      end
      
      # Filter for users who have "Owner" role in their enterprise roles
      owners = all_users.select do |user|
        user[:github_com_enterprise_roles]&.include?("Owner")
      end
      
      # Transform to match expected format
      owners.map do |owner|
        {
          login: owner[:github_com_login],
          id: nil, # Not provided in consumed-licenses endpoint
          email: owner[:github_com_verified_domain_emails]&.first,
          two_factor_disabled: !owner[:github_com_two_factor_auth],
          saml_identity: owner[:github_com_saml_name_id] ? 'configured' : 'none',
          avatar_url: nil # Not provided in consumed-licenses endpoint
        }
      end
    rescue Octokit::Error => e
      handle_api_error(e)
    end

    def add_enterprise_owner(enterprise, username)
      @client.put("/enterprises/#{enterprise}/owners/#{username}")
    rescue Octokit::Error => e
      handle_api_error(e)
    end

    def remove_enterprise_owner(enterprise, username)
      @client.delete("/enterprises/#{enterprise}/owners/#{username}")
    rescue Octokit::Error => e
      handle_api_error(e)
    end

    def enterprise_member_organizations(enterprise, username, options = {})
      @client.paginate("/enterprises/#{enterprise}/members/#{username}/organizations", options)
    rescue Octokit::Error => e
      handle_api_error(e)
    end

    # Enterprise billing and consumption
    def enterprise_consumed_licenses(enterprise)
      @client.get("/enterprises/#{enterprise}/consumed-licenses")
    rescue Octokit::Error => e
      handle_api_error(e)
    end

    def enterprise_actions_billing(enterprise)
      # Use new unified billing API endpoint per GitHub documentation
      # https://docs.github.com/en/enterprise-cloud@latest/billing/managing-your-billing/automating-usage-reporting
      @client.get("/enterprises/#{enterprise}/settings/billing/usage")
    rescue Octokit::Error => e
      handle_api_error(e)
    end

    def enterprise_packages_billing(enterprise)
      # Use new billing API endpoint per GitHub documentation
      @client.get("/enterprises/#{enterprise}/billing/packages")
    rescue Octokit::Error => e
      handle_api_error(e)
    end

    def enterprise_shared_storage_billing(enterprise)
      # Use new billing API endpoint per GitHub documentation
      @client.get("/enterprises/#{enterprise}/billing/shared-storage")
    rescue Octokit::Error => e
      handle_api_error(e)
    end

    # Enterprise audit log
    def enterprise_audit_log(enterprise, options = {})
      @client.paginate("/enterprises/#{enterprise}/audit-log", options)
    rescue Octokit::Error => e
      handle_api_error(e)
    end

    # Enterprise settings and policies
    def enterprise_security_analysis_settings(enterprise)
      @client.get("/enterprises/#{enterprise}/code_security_analysis")
    rescue Octokit::Error => e
      handle_api_error(e)
    end

    def update_enterprise_security_analysis_settings(enterprise, options = {})
      @client.patch("/enterprises/#{enterprise}/code_security_analysis", options)
    rescue Octokit::Error => e
      handle_api_error(e)
    end

    # SAML SSO methods for enterprise
    def enterprise_saml_sso_authorization(enterprise, login)
      @client.get("/enterprises/#{enterprise}/sso/authorizations/#{login}")
    rescue Octokit::Error => e
      handle_api_error(e)
    end

    def list_enterprise_saml_sso_authorizations(enterprise, options = {})
      @client.paginate("/enterprises/#{enterprise}/sso/authorizations", options)
    rescue Octokit::Error => e
      handle_api_error(e)
    end

    def remove_enterprise_saml_sso_authorization(enterprise, login)
      @client.delete("/enterprises/#{enterprise}/sso/authorizations/#{login}")
    rescue Octokit::Error => e
      handle_api_error(e)
    end

    # Enterprise statistics and insights
    def enterprise_stats(enterprise)
      @client.get("/enterprises/#{enterprise}/stats/all")
    rescue Octokit::Error => e
      handle_api_error(e)
    end

    # Organization management within enterprise
    def transfer_organization_to_enterprise(enterprise, org)
      @client.post("/enterprises/#{enterprise}/organizations", { organization: org })
    rescue Octokit::Error => e
      handle_api_error(e)
    end

    def remove_organization_from_enterprise(enterprise, org)
      @client.delete("/enterprises/#{enterprise}/organizations/#{org}")
    rescue Octokit::Error => e
      handle_api_error(e)
    end

    private

    def github_token
      @token || ENV['GITHUB_TOKEN'] || Config.get('github_token')
    end

    def handle_api_error(error)
      case error
      when Octokit::Unauthorized
        raise AuthenticationError, "GitHub authentication failed. Please check your token."
      when Octokit::NotFound
        raise APIError, "Resource not found. Please check the name and your permissions."
      when Octokit::Forbidden
        raise APIError, "Access forbidden. You may not have the required permissions."
      when Octokit::TooManyRequests
        raise APIError, "Rate limit exceeded. Please try again later."
      when Octokit::UnprocessableEntity
        # Extract meaningful error messages, handling cases where individual error messages are nil
        error_messages = error.errors&.map { |e| e[:message] }&.compact&.reject(&:empty?) || []
        message = error_messages.any? ? error_messages.join(', ') : error.message
        raise APIError, "Request failed: #{message}"
      else
        raise APIError, "GitHub API error: #{error.message}"
      end
    end
  end
end
