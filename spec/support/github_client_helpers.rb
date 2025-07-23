# frozen_string_literal: true

module GitHubClientHelpers
  def mock_github_client
    @mock_github_client ||= instance_double(Hubctl::GitHubClient)
  end

  def stub_github_client_authentication(authenticated: true)
    allow(mock_github_client).to receive(:authenticated?).and_return(authenticated)
  end

  def setup_authenticated_client
    stub_github_client_authentication(authenticated: true)
    allow(Hubctl::GitHubClient).to receive(:new).and_return(mock_github_client)
  end

  # Sample data for enterprise actions billing
  def sample_enterprise_actions_billing_payload
    {
      total_minutes_used: 15000,
      total_paid_minutes_used: 5000,
      included_minutes: 10000,
      minutes_used_breakdown: {
        ubuntu: 8000,
        windows: 4000,
        macos: 3000
      }
    }
  end

  def sample_enterprise_consumed_licenses_payload
    {
      total_seats_consumed: 95,
      total_seats_purchased: 100,
      total_advanced_security_committers: 85
    }
  end

  def sample_enterprise_packages_billing_payload
    {
      total_gigabytes_bandwidth_used: 500,
      total_paid_gigabytes_bandwidth_used: 100,
      included_gigabytes_bandwidth: 400
    }
  end

  def sample_enterprise_storage_billing_payload
    {
      days_left_in_billing_cycle: 15,
      estimated_paid_storage_for_month: 25,
      estimated_storage_usage: 125
    }
  end
end

RSpec.configure do |config|
  config.include GitHubClientHelpers
end
