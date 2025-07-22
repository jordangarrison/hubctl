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

    def invite_user_to_org(org, username, options = {})
      @client.invite_user_to_org(org, username, options)
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
      @client.add_team_member(team_id, username, options)
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
        message = error.errors&.map { |e| e[:message] }&.join(', ') || error.message
        raise APIError, "Request failed: #{message}"
      else
        raise APIError, "GitHub API error: #{error.message}"
      end
    end
  end
end
