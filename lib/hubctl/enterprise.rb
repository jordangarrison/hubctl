# frozen_string_literal: true

require 'thor'

module Hubctl
  # Nested SAML SSO subcommand class - defined first so it can be referenced
  class SamlSso < BaseCommand
    desc 'list ENTERPRISE', 'List SAML SSO authorizations'
    def list(enterprise)
      ensure_authenticated!

      begin
        authorizations = with_spinner("Fetching SAML SSO authorizations") do
          github_client.list_enterprise_saml_sso_authorizations(enterprise)
        end

        # Transform data for display
        auth_data = authorizations.map do |auth|
          {
            login: auth[:login],
            saml_identity: auth[:saml_identity][:username],
            name_id: auth[:saml_identity][:name_id],
            last_used: auth[:last_used],
            credential_authorized_at: auth[:credential_authorized_at],
            credential_expires_at: auth[:credential_expires_at]
          }
        end

        formatter.output(auth_data, headers: %w[login saml_identity name_id last_used credential_authorized_at credential_expires_at])

        formatter.success("Found #{authorizations.length} SAML SSO authorizations")
      rescue => e
        handle_error(e)
      end
    end

    desc 'show ENTERPRISE LOGIN', 'Show SAML SSO authorization for user'
    def show(enterprise, login)
      ensure_authenticated!

      begin
        auth = with_spinner("Fetching SAML SSO authorization") do
          github_client.enterprise_saml_sso_authorization(enterprise, login)
        end

        auth_details = {
          login: auth[:login],
          saml_identity_username: auth[:saml_identity][:username],
          saml_identity_name_id: auth[:saml_identity][:name_id],
          last_used: auth[:last_used],
          credential_authorized_at: auth[:credential_authorized_at],
          credential_expires_at: auth[:credential_expires_at],
          organization_count: auth[:organization_count]
        }

        formatter.output(auth_details)
      rescue => e
        handle_error(e)
      end
    end

    desc 'remove ENTERPRISE LOGIN', 'Remove SAML SSO authorization'
    def remove(enterprise, login)
      ensure_authenticated!

      unless confirm_action("Remove SAML SSO authorization for #{login} from enterprise #{enterprise}?")
        formatter.info("Operation cancelled")
        return
      end

      begin
        with_spinner("Removing SAML SSO authorization") do
          github_client.remove_enterprise_saml_sso_authorization(enterprise, login)
        end

        formatter.success("Successfully removed SAML SSO authorization for #{login}")
      rescue => e
        handle_error(e)
      end
    end
  end

  class Enterprise < BaseCommand
    desc 'show ENTERPRISE', 'Show enterprise details'
    def show(enterprise)
      ensure_authenticated!

      begin
        enterprise_data = with_spinner("Fetching enterprise details") do
          github_client.enterprise(enterprise)
        end

        enterprise_details = {
          name: enterprise_data[:name],
          slug: enterprise_data[:slug],
          description: enterprise_data[:description],
          website_url: enterprise_data[:website_url],
          avatar_url: enterprise_data[:avatar_url],
          billing_email: enterprise_data[:billing_email],
          plan: enterprise_data[:plan],
          public_repos: enterprise_data[:public_repos],
          private_repos: enterprise_data[:private_repos],
          public_gists: enterprise_data[:public_gists],
          private_gists: enterprise_data[:private_gists],
          owned_private_repos: enterprise_data[:owned_private_repos],
          total_private_repos: enterprise_data[:total_private_repos],
          collaborators: enterprise_data[:collaborators],
          disk_usage: "#{enterprise_data[:disk_usage]} KB",
          created_at: enterprise_data[:created_at],
          updated_at: enterprise_data[:updated_at]
        }

        formatter.output(enterprise_details)
      rescue => e
        handle_error(e)
      end
    end

    desc 'members ENTERPRISE', 'List enterprise members'
    method_option :role, type: :string, desc: 'Filter by role (member, admin, billing_manager)'
    method_option :two_factor_disabled, type: :boolean, desc: 'Filter for users without 2FA'
    def members(enterprise)
      ensure_authenticated!

      begin
        options_hash = {}
        options_hash[:role] = options[:role] if options[:role]
        options_hash[:two_factor_disabled] = options[:two_factor_disabled] if options[:two_factor_disabled]

        members = with_spinner("Fetching enterprise members") do
          github_client.enterprise_members(enterprise, options_hash)
        end

        # Transform data for display
        member_data = members.map do |member|
          {
            login: member[:login],
            id: member[:id],
            role: member[:role],
            email: member[:email],
            two_factor_disabled: member[:two_factor_disabled] || false,
            saml_identity: member[:saml_identity] ? 'configured' : 'none',
            avatar_url: member[:avatar_url]
          }
        end

        formatter.output(member_data, headers: %w[login role email two_factor_disabled saml_identity])

        role_text = options[:role] || 'all roles'
        formatter.success("Found #{members.length} members (#{role_text}) in enterprise #{enterprise}")
      rescue => e
        handle_error(e)
      end
    end

    desc 'owners ENTERPRISE', 'List enterprise owners'
    def owners(enterprise)
      ensure_authenticated!

      begin
        owners = with_spinner("Fetching enterprise owners") do
          github_client.enterprise_owners(enterprise)
        end

        # Transform data for display
        owner_data = owners.map do |owner|
          {
            login: owner[:login],
            id: owner[:id],
            email: owner[:email],
            role: 'owner',
            two_factor_disabled: owner[:two_factor_disabled] || false,
            saml_identity: owner[:saml_identity] ? 'configured' : 'none',
            avatar_url: owner[:avatar_url]
          }
        end

        formatter.output(owner_data, headers: %w[login email role two_factor_disabled saml_identity])

        formatter.success("Found #{owners.length} owners in enterprise #{enterprise}")
      rescue => e
        handle_error(e)
      end
    end

    desc 'add-owner ENTERPRISE USERNAME', 'Add enterprise owner'
    def add_owner(enterprise, username)
      ensure_authenticated!

      unless confirm_action("Are you sure you want to add #{username} as an owner of enterprise #{enterprise}?")
        formatter.info("Operation cancelled")
        return
      end

      begin
        with_spinner("Adding enterprise owner") do
          github_client.add_enterprise_owner(enterprise, username)
        end

        formatter.success("Successfully added #{username} as owner of enterprise #{enterprise}")
      rescue => e
        handle_error(e)
      end
    end

    desc 'remove-owner ENTERPRISE USERNAME', 'Remove enterprise owner'
    def remove_owner(enterprise, username)
      ensure_authenticated!

      unless confirm_action("Are you sure you want to remove #{username} as an owner of enterprise #{enterprise}?")
        formatter.info("Operation cancelled")
        return
      end

      begin
        with_spinner("Removing enterprise owner") do
          github_client.remove_enterprise_owner(enterprise, username)
        end

        formatter.success("Successfully removed #{username} as owner of enterprise #{enterprise}")
      rescue => e
        handle_error(e)
      end
    end

    desc 'organizations ENTERPRISE', 'List enterprise organizations'
    method_option :per_page, type: :numeric, default: 30, desc: 'Number of organizations per page'
    def organizations(enterprise)
      ensure_authenticated!

      begin
        options_hash = { per_page: options[:per_page] }

        orgs = with_spinner("Fetching enterprise organizations") do
          github_client.enterprise_organizations(enterprise, options_hash)
        end

        # Transform data for display
        org_data = orgs.map do |org|
          {
            login: org[:login],
            id: org[:id],
            description: org[:description] || '-',
            public_repos: org[:public_repos],
            private_repos: org[:private_repos],
            plan: org[:plan]&.[](:name) || 'unknown',
            billing_email: org[:billing_email] || '-',
            members_count: org[:members_count] || 0,
            teams_count: org[:teams_count] || 0,
            created_at: org[:created_at],
            url: org[:html_url]
          }
        end

        formatter.output(org_data, headers: %w[login description public_repos private_repos plan members_count teams_count created_at])

        formatter.success("Found #{orgs.length} organizations in enterprise #{enterprise}")
      rescue => e
        handle_error(e)
      end
    end

    desc 'create-org ENTERPRISE ORG_LOGIN', 'Create new organization in enterprise'
    method_option :display_name, type: :string, desc: 'Display name for the organization'
    method_option :description, type: :string, desc: 'Description for the organization'
    method_option :billing_email, type: :string, desc: 'Billing email for the organization'
    def create_org(enterprise, org_login)
      ensure_authenticated!

      unless confirm_action("Create organization '#{org_login}' in enterprise #{enterprise}?")
        formatter.info("Operation cancelled")
        return
      end

      begin
        org_options = {}
        org_options[:display_name] = options[:display_name] if options[:display_name]
        org_options[:description] = options[:description] if options[:description]
        org_options[:billing_email] = options[:billing_email] if options[:billing_email]

        org = with_spinner("Creating organization") do
          github_client.create_enterprise_organization(enterprise, org_login, org_options)
        end

        formatter.success("Successfully created organization '#{org_login}' in enterprise #{enterprise}")
        formatter.info("Organization ID: #{org[:id]}")
        formatter.info("URL: #{org[:html_url]}")
      rescue => e
        handle_error(e)
      end
    end

    desc 'billing ENTERPRISE', 'Show enterprise billing information'
    def billing(enterprise)
      ensure_authenticated!

      begin
        billing_data = with_spinner("Fetching enterprise billing information") do
          github_client.enterprise_actions_billing(enterprise)
        end

        # Process the new usageItems format
        usage_items = billing_data[:usageItems] || []
        
        if usage_items.empty?
          formatter.info("No billing usage data found for enterprise #{enterprise}")
          return
        end

        # Group usage items by product
        actions_items = usage_items.select { |item| item[:product] == 'actions' }
        packages_items = usage_items.select { |item| item[:product] == 'packages' }
        copilot_items = usage_items.select { |item| item[:product] == 'copilot' }

        # Build structured billing data
        billing_summary = {
          enterprise: enterprise,
          total_cost: usage_items.sum { |item| item[:netAmount] || 0 }.round(2)
        }

        # GitHub Actions billing
        unless actions_items.empty?
          total_minutes = actions_items.select { |item| item[:unitType] == 'Minutes' }
                                     .sum { |item| item[:quantity] || 0 }
          total_cost = actions_items.sum { |item| item[:netAmount] || 0 }
          
          # Group by runner type (SKU)
          runner_breakdown = {}
          actions_items.select { |item| item[:unitType] == 'Minutes' }.each do |item|
            sku = item[:sku] || 'Unknown'
            runner_breakdown[sku] ||= { minutes: 0, cost: 0 }
            runner_breakdown[sku][:minutes] += item[:quantity] || 0
            runner_breakdown[sku][:cost] += item[:netAmount] || 0
          end
          
          # Add percentage to runner breakdown
          runner_breakdown.each do |sku, data|
            data[:percentage] = total_minutes > 0 ? ((data[:minutes] / total_minutes) * 100).round(1) : 0
            data[:minutes] = data[:minutes].to_i
            data[:cost] = data[:cost].round(2)
          end
          
          billing_summary[:actions] = {
            total_minutes: total_minutes.to_i,
            total_cost: total_cost.round(2),
            runner_breakdown: runner_breakdown
          }
        end

        # GitHub Packages billing
        unless packages_items.empty?
          total_storage = packages_items.select { |item| item[:sku]&.include?('storage') }
                                       .sum { |item| item[:quantity] || 0 }
          total_transfer = packages_items.select { |item| item[:sku]&.include?('transfer') }
                                        .sum { |item| item[:quantity] || 0 }
          total_packages_cost = packages_items.sum { |item| item[:netAmount] || 0 }
          
          billing_summary[:packages] = {
            total_storage_gb_hours: total_storage.round(2),
            total_data_transfer_gb: total_transfer.round(2),
            total_cost: total_packages_cost.round(2)
          }
        end

        # GitHub Copilot billing
        unless copilot_items.empty?
          total_users = copilot_items.sum { |item| item[:quantity] || 0 }
          total_copilot_cost = copilot_items.sum { |item| item[:netAmount] || 0 }
          
          billing_summary[:copilot] = {
            total_user_months: total_users.round(2),
            total_cost: total_copilot_cost.round(2)
          }
        end

        # Output the billing data differently based on format
        # JSON format gets the structured data, table format gets flattened data
        if formatter.json?
          formatter.output(billing_summary)
        else
          # Create flattened data for better table display
          flattened_data = flatten_billing_summary(billing_summary)
          formatter.output(flattened_data, headers: %w[category metric value])
        end
        
      rescue => e
        handle_error(e)
      end
    end

    desc 'audit-log ENTERPRISE', 'Show enterprise audit log'
    method_option :phrase, type: :string, desc: 'Search phrase for audit log entries'
    method_option :after, type: :string, desc: 'Show entries after this timestamp (ISO format)'
    method_option :before, type: :string, desc: 'Show entries before this timestamp (ISO format)'
    method_option :order, type: :string, default: 'desc', desc: 'Sort order (asc, desc)'
    method_option :per_page, type: :numeric, default: 30, desc: 'Number of entries per page'
    def audit_log(enterprise)
      ensure_authenticated!

      begin
        audit_options = { per_page: options[:per_page], order: options[:order] }
        audit_options[:phrase] = options[:phrase] if options[:phrase]
        audit_options[:after] = options[:after] if options[:after]
        audit_options[:before] = options[:before] if options[:before]

        audit_entries = with_spinner("Fetching enterprise audit log") do
          github_client.enterprise_audit_log(enterprise, audit_options)
        end

        # Transform data for display
        audit_data = audit_entries.map do |entry|
          {
            timestamp: entry[:timestamp],
            action: entry[:action],
            actor: entry[:actor],
            user: entry[:user],
            repo: entry[:repo],
            org: entry[:org],
            created_at: entry[:created_at],
            document_id: entry[:document_id]
          }
        end

        formatter.output(audit_data, headers: %w[timestamp action actor user repo org])

        formatter.success("Found #{audit_entries.length} audit log entries")
      rescue => e
        handle_error(e)
      end
    end

    desc 'stats ENTERPRISE', 'Show enterprise statistics'
    def stats(enterprise)
      ensure_authenticated!

      begin
        stats = with_spinner("Fetching enterprise statistics") do
          github_client.enterprise_stats(enterprise)
        end

        formatter.info("=== Enterprise Statistics ===")

        if stats[:repos]
          formatter.info("Repositories:")
          formatter.info("  Total: #{stats[:repos][:total_repos]}")
          formatter.info("  Root: #{stats[:repos][:root_repos]}")
          formatter.info("  Fork: #{stats[:repos][:fork_repos]}")
          formatter.info("  Org repos: #{stats[:repos][:org_repos]}")
        end

        if stats[:hooks]
          formatter.info("\nHooks:")
          formatter.info("  Total: #{stats[:hooks][:total_hooks]}")
          formatter.info("  Active: #{stats[:hooks][:active_hooks]}")
          formatter.info("  Inactive: #{stats[:hooks][:inactive_hooks]}")
        end

        if stats[:pages]
          formatter.info("\nPages:")
          formatter.info("  Total: #{stats[:pages][:total_pages]}")
        end

        if stats[:orgs]
          formatter.info("\nOrganizations:")
          formatter.info("  Total: #{stats[:orgs][:total_orgs]}")
          formatter.info("  Disabled: #{stats[:orgs][:disabled_orgs]}")
          formatter.info("  Total teams: #{stats[:orgs][:total_teams]}")
          formatter.info("  Total team members: #{stats[:orgs][:total_team_members]}")
        end

        if stats[:users]
          formatter.info("\nUsers:")
          formatter.info("  Total: #{stats[:users][:total_users]}")
          formatter.info("  Admin users: #{stats[:users][:admin_users]}")
          formatter.info("  Suspended users: #{stats[:users][:suspended_users]}")
        end

        if stats[:pull_requests]
          formatter.info("\nPull Requests:")
          formatter.info("  Total: #{stats[:pull_requests][:total_pulls]}")
          formatter.info("  Merged: #{stats[:pull_requests][:merged_pulls]}")
          formatter.info("  Mergeable: #{stats[:pull_requests][:mergeable_pulls]}")
          formatter.info("  Unmergeable: #{stats[:pull_requests][:unmergeable_pulls]}")
        end

        if stats[:issues]
          formatter.info("\nIssues:")
          formatter.info("  Total: #{stats[:issues][:total_issues]}")
          formatter.info("  Open: #{stats[:issues][:open_issues]}")
          formatter.info("  Closed: #{stats[:issues][:closed_issues]}")
        end

        if stats[:milestones]
          formatter.info("\nMilestones:")
          formatter.info("  Total: #{stats[:milestones][:total_milestones]}")
          formatter.info("  Open: #{stats[:milestones][:open_milestones]}")
          formatter.info("  Closed: #{stats[:milestones][:closed_milestones]}")
        end

        if stats[:gists]
          formatter.info("\nGists:")
          formatter.info("  Total: #{stats[:gists][:total_gists]}")
          formatter.info("  Private: #{stats[:gists][:private_gists]}")
          formatter.info("  Public: #{stats[:gists][:public_gists]}")
        end
      rescue => e
        handle_error(e)
      end
    end

    desc 'security ENTERPRISE', 'Manage enterprise security analysis settings'
    method_option :dependency_graph_enabled_for_new_repositories, type: :boolean,
                  desc: 'Enable dependency graph for new repositories'
    method_option :dependency_graph_enabled_for_new_repositories_value, type: :string,
                  desc: 'Value for dependency graph (enabled, disabled, not_set)'
    method_option :secret_scanning_enabled_for_new_repositories, type: :boolean,
                  desc: 'Enable secret scanning for new repositories'
    method_option :secret_scanning_push_protection_enabled_for_new_repositories, type: :boolean,
                  desc: 'Enable secret scanning push protection for new repositories'
    def security(enterprise)
      ensure_authenticated!

      if options.any? { |_, v| !v.nil? }
        # Update security settings
        unless confirm_action("Update enterprise security analysis settings?")
          formatter.info("Operation cancelled")
          return
        end

        begin
          update_options = {}
          update_options[:dependency_graph_enabled_for_new_repositories] = options[:dependency_graph_enabled_for_new_repositories] if options[:dependency_graph_enabled_for_new_repositories]
          update_options[:secret_scanning_enabled_for_new_repositories] = options[:secret_scanning_enabled_for_new_repositories] if options[:secret_scanning_enabled_for_new_repositories]
          update_options[:secret_scanning_push_protection_enabled_for_new_repositories] = options[:secret_scanning_push_protection_enabled_for_new_repositories] if options[:secret_scanning_push_protection_enabled_for_new_repositories]

          with_spinner("Updating security analysis settings") do
            github_client.update_enterprise_security_analysis_settings(enterprise, update_options)
          end

          formatter.success("Successfully updated enterprise security analysis settings")
        rescue => e
          handle_error(e)
        end
      else
        # Show current security settings
        begin
          settings = with_spinner("Fetching security analysis settings") do
            github_client.enterprise_security_analysis_settings(enterprise)
          end

          formatter.info("=== Enterprise Security Analysis Settings ===")
          formatter.info("Dependency Graph for New Repos: #{settings[:dependency_graph_enabled_for_new_repositories]}")
          formatter.info("Secret Scanning for New Repos: #{settings[:secret_scanning_enabled_for_new_repositories]}")
          formatter.info("Secret Scanning Push Protection for New Repos: #{settings[:secret_scanning_push_protection_enabled_for_new_repositories]}")
        rescue => e
          handle_error(e)
        end
      end
    end

    desc 'saml-sso ENTERPRISE', 'Manage enterprise SAML SSO authorizations'
    subcommand 'saml-sso', SamlSso

    private

    # Flatten the billing summary into a table-friendly array of hashes
    def flatten_billing_summary(billing_summary)
      table_data = []
      
      # Enterprise summary
      table_data << { category: "Enterprise", metric: "Name", value: billing_summary[:enterprise] }
      table_data << { category: "Enterprise", metric: "Total Cost", value: "$#{billing_summary[:total_cost]}" }
      
      # GitHub Actions billing
      if billing_summary[:actions]
        actions = billing_summary[:actions]
        table_data << { category: "Actions", metric: "Total Minutes", value: actions[:total_minutes].to_s }
        table_data << { category: "Actions", metric: "Total Cost", value: "$#{actions[:total_cost]}" }
        
        # Runner breakdown sorted by minutes (descending)
        actions[:runner_breakdown].sort_by { |_, data| -data[:minutes] }.each do |sku, data|
          table_data << { 
            category: "Actions - #{sku}", 
            metric: "Minutes (Share)", 
            value: "#{data[:minutes]} (#{data[:percentage]}%)" 
          }
          table_data << { 
            category: "Actions - #{sku}", 
            metric: "Cost", 
            value: "$#{data[:cost]}" 
          }
        end
      end
      
      # GitHub Packages billing
      if billing_summary[:packages]
        packages = billing_summary[:packages]
        table_data << { category: "Packages", metric: "Storage (GB-hours)", value: packages[:total_storage_gb_hours].to_s }
        table_data << { category: "Packages", metric: "Data Transfer (GB)", value: packages[:total_data_transfer_gb].to_s }
        table_data << { category: "Packages", metric: "Total Cost", value: "$#{packages[:total_cost]}" }
      end
      
      # GitHub Copilot billing
      if billing_summary[:copilot]
        copilot = billing_summary[:copilot]
        table_data << { category: "Copilot", metric: "User-Months", value: copilot[:total_user_months].to_s }
        table_data << { category: "Copilot", metric: "Total Cost", value: "$#{copilot[:total_cost]}" }
      end
      
      table_data
    end

    # Calculate estimated cost based on GitHub Actions pricing
    # Basic GitHub pricing as of 2024 (subject to change):
    # - Linux/Ubuntu: $0.008 per minute
    # - Windows: $0.016 per minute  
    # - macOS: $0.08 per minute
    def calculate_estimated_cost(breakdown, paid_minutes)
      return 0 unless breakdown && paid_minutes > 0
      
      # Rough cost calculation based on runner type distribution
      total_breakdown_minutes = breakdown.values.sum(&:to_i)
      return 0 if total_breakdown_minutes == 0
      
      estimated_cost = 0.0
      
      breakdown.each do |runner_type, minutes|
        next if minutes.to_i == 0
        
        # Calculate the proportion of paid minutes for this runner type
        proportion = minutes.to_f / total_breakdown_minutes
        paid_minutes_for_type = (paid_minutes * proportion).round
        
        # Apply pricing based on runner type
        case runner_type.to_s.upcase
        when 'UBUNTU', 'LINUX'
          estimated_cost += paid_minutes_for_type * 0.008
        when 'WINDOWS'
          estimated_cost += paid_minutes_for_type * 0.016
        when 'MACOS'
          estimated_cost += paid_minutes_for_type * 0.08
        else
          # Default to Linux pricing for unknown types
          estimated_cost += paid_minutes_for_type * 0.008
        end
      end
      
      estimated_cost.round(2)
    end
  end
end
