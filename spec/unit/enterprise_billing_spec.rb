# frozen_string_literal: true

require 'spec_helper'

RSpec.describe Hubctl::Enterprise, '#billing' do
  let(:enterprise_command) { described_class.new }
  let(:enterprise_name) { 'dummy-enterprise' }

  before do
    setup_authenticated_client
    
    # Mock the formatter to avoid TTY dependencies in tests
    @mock_formatter = instance_double('Formatter',
      info: nil,
      success: nil,
      error: nil,
      output: nil
    )
    allow(enterprise_command).to receive(:formatter).and_return(@mock_formatter)
    
    # Mock the spinner methods
    allow(enterprise_command).to receive(:with_spinner).and_yield
  end

  describe 'when fetching billing information successfully' do
    before do
      # Stub all the billing API calls with sample data
      allow(mock_github_client).to receive(:enterprise_consumed_licenses)
        .with(enterprise_name)
        .and_return(sample_enterprise_consumed_licenses_payload)
      
      allow(mock_github_client).to receive(:enterprise_actions_billing)
        .with(enterprise_name)
        .and_return(sample_enterprise_actions_billing_payload)
      
      allow(mock_github_client).to receive(:enterprise_packages_billing)
        .with(enterprise_name)
        .and_return(sample_enterprise_packages_billing_payload)
      
      allow(mock_github_client).to receive(:enterprise_shared_storage_billing)
        .with(enterprise_name)
        .and_return(sample_enterprise_storage_billing_payload)
    end

    it 'displays license consumption information' do
      enterprise_command.billing(enterprise_name)
      
      expect(@mock_formatter).to have_received(:info).with('=== Enterprise License Consumption ===')
      expect(@mock_formatter).to have_received(:info).with('Total seats: 95/100')
      expect(@mock_formatter).to have_received(:info).with('Active users: 85')
    end

    it 'displays GitHub Actions billing with corrected labels' do
      enterprise_command.billing(enterprise_name)
      
      expect(@mock_formatter).to have_received(:info).with("\n=== GitHub Actions Billing ===")
      expect(@mock_formatter).to have_received(:info).with('Total minutes used: 15000')
      expect(@mock_formatter).to have_received(:info).with('Paid minutes used: 5000')
      expect(@mock_formatter).to have_received(:info).with('Included free minutes: 10000')
      expect(@mock_formatter).to have_received(:info).with('Percentage of included minutes used: 150.0%')
    end

    it 'displays runner breakdown with corrected labels' do
      enterprise_command.billing(enterprise_name)
      
      expect(@mock_formatter).to have_received(:info).with('Minutes used by runner type:')
      expect(@mock_formatter).to have_received(:info).with('  Ubuntu: 8000')
      expect(@mock_formatter).to have_received(:info).with('  Windows: 4000')
      expect(@mock_formatter).to have_received(:info).with('  Macos: 3000')
    end

    it 'displays packages billing information' do
      enterprise_command.billing(enterprise_name)
      
      expect(@mock_formatter).to have_received(:info).with("\n=== Packages Billing ===")
      expect(@mock_formatter).to have_received(:info).with('Total gigabytes bandwidth used: 500')
      expect(@mock_formatter).to have_received(:info).with('Total paid gigabytes bandwidth used: 100')
      expect(@mock_formatter).to have_received(:info).with('Included gigabytes bandwidth: 400')
    end

    it 'displays shared storage billing information' do
      enterprise_command.billing(enterprise_name)
      
      expect(@mock_formatter).to have_received(:info).with("\n=== Shared Storage Billing ===")
      expect(@mock_formatter).to have_received(:info).with('Days left in billing cycle: 15')
      expect(@mock_formatter).to have_received(:info).with('Estimated paid storage for month: 25 GB')
      expect(@mock_formatter).to have_received(:info).with('Estimated storage usage: 125 GB')
    end
  end

  describe 'when some billing APIs fail' do
    before do
      allow(mock_github_client).to receive(:enterprise_consumed_licenses)
        .with(enterprise_name)
        .and_return(sample_enterprise_consumed_licenses_payload)
      
      # Actions billing succeeds
      allow(mock_github_client).to receive(:enterprise_actions_billing)
        .with(enterprise_name)
        .and_return(sample_enterprise_actions_billing_payload)
      
      # Packages billing fails
      allow(mock_github_client).to receive(:enterprise_packages_billing)
        .with(enterprise_name)
        .and_raise(StandardError.new('API Error'))
      
      # Storage billing fails
      allow(mock_github_client).to receive(:enterprise_shared_storage_billing)
        .with(enterprise_name)
        .and_raise(StandardError.new('API Error'))
    end

    it 'continues processing and shows available data' do
      enterprise_command.billing(enterprise_name)
      
      # Should still show license and actions billing
      expect(@mock_formatter).to have_received(:info).with('=== Enterprise License Consumption ===')
      expect(@mock_formatter).to have_received(:info).with("\n=== GitHub Actions Billing ===")
      
      # Should not show packages or storage billing sections
      expect(@mock_formatter).not_to have_received(:info).with("\n=== Packages Billing ===")
      expect(@mock_formatter).not_to have_received(:info).with("\n=== Shared Storage Billing ===")
    end
  end

  describe 'when actions billing returns empty breakdown' do
    let(:empty_actions_billing) do
      {
        total_minutes_used: 5000,
        total_paid_minutes_used: 1000,
        included_minutes: 10000,
        minutes_used_breakdown: {}
      }
    end

    before do
      allow(mock_github_client).to receive(:enterprise_consumed_licenses)
        .with(enterprise_name)
        .and_return(sample_enterprise_consumed_licenses_payload)
      
      allow(mock_github_client).to receive(:enterprise_actions_billing)
        .with(enterprise_name)
        .and_return(empty_actions_billing)
      
      allow(mock_github_client).to receive(:enterprise_packages_billing)
        .with(enterprise_name)
        .and_return(nil)
      
      allow(mock_github_client).to receive(:enterprise_shared_storage_billing)
        .with(enterprise_name)
        .and_return(nil)
    end

    it 'shows actions billing without runner breakdown' do
      enterprise_command.billing(enterprise_name)
      
      expect(@mock_formatter).to have_received(:info).with("\n=== GitHub Actions Billing ===")
      expect(@mock_formatter).to have_received(:info).with('Total minutes used: 5000')
      expect(@mock_formatter).to have_received(:info).with('Paid minutes used: 1000')
      expect(@mock_formatter).to have_received(:info).with('Included free minutes: 10000')
      expect(@mock_formatter).to have_received(:info).with('Percentage of included minutes used: 50.0%')
      
      # Should not show empty breakdown
      expect(@mock_formatter).not_to have_received(:info).with('Minutes used by runner type:')
    end
  end

  describe 'authentication handling' do
    before do
      # Mock unauthenticated client
      allow(Hubctl::GitHubClient).to receive(:new).and_return(mock_github_client)
      allow(mock_github_client).to receive(:authenticated?).and_return(false)
      
      # Mock the exit method to raise SystemExit instead of actually exiting
      allow(enterprise_command).to receive(:exit).with(1).and_raise(SystemExit)
    end

    it 'handles authentication failure' do
      expect { enterprise_command.billing(enterprise_name) }.to raise_error(SystemExit)
    end
  end

  describe 'error handling' do
    before do
      setup_authenticated_client
      
      # Mock all billing methods to raise API error
      allow(mock_github_client).to receive(:enterprise_consumed_licenses)
        .with(enterprise_name)
        .and_raise(Hubctl::GitHubClient::APIError.new('API request failed'))
      
      allow(enterprise_command).to receive(:handle_error)
    end

    it 'handles API errors gracefully' do
      expect(enterprise_command).to receive(:handle_error)
      
      enterprise_command.billing(enterprise_name)
    end
  end
end
