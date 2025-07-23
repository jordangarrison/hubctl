# frozen_string_literal: true

require 'spec_helper'

RSpec.describe 'hubctl enterprise billing smoke test', :smoke do
  let(:enterprise_name) { 'dummy-enterprise' }
  let(:enterprise_command) { Hubctl::Enterprise.new }

  before do
    # Set up environment to avoid actual GitHub API calls
    allow(ENV).to receive(:[]).and_call_original
    allow(ENV).to receive(:[]).with('GITHUB_TOKEN').and_return('test-token')
    
    # Mock the GitHub client at the class level
    @mock_client = instance_double(Hubctl::GitHubClient)
    allow(Hubctl::GitHubClient).to receive(:new).and_return(@mock_client)
    allow(@mock_client).to receive(:authenticated?).and_return(true)
    
    # Mock the spinner to avoid TTY dependencies
    allow(enterprise_command).to receive(:with_spinner).and_yield
  end

  context 'when CLI command is invoked with mocked client' do
    before do
      # Set up successful mocks for all billing endpoints
      allow(@mock_client).to receive(:enterprise_consumed_licenses)
        .with(enterprise_name)
        .and_return({
          total_seats_consumed: 95,
          total_seats_purchased: 100,
          total_advanced_security_committers: 85
        })
      
      allow(@mock_client).to receive(:enterprise_actions_billing)
        .with(enterprise_name)
        .and_return({
          total_minutes_used: 15000,
          total_paid_minutes_used: 5000,
          included_minutes: 10000,
          minutes_used_breakdown: {
            ubuntu: 8000,
            windows: 4000,
            macos: 3000
          }
        })
      
      allow(@mock_client).to receive(:enterprise_packages_billing)
        .with(enterprise_name)
        .and_return({
          total_gigabytes_bandwidth_used: 500,
          total_paid_gigabytes_bandwidth_used: 100,
          included_gigabytes_bandwidth: 400
        })
      
      allow(@mock_client).to receive(:enterprise_shared_storage_billing)
        .with(enterprise_name)
        .and_return({
          days_left_in_billing_cycle: 15,
          estimated_paid_storage_for_month: 25,
          estimated_storage_usage: 125
        })
    end

    it 'successfully executes and outputs expected billing information' do
      # Create an instance of the Enterprise command
      enterprise_command = Hubctl::Enterprise.new
      
      # Capture output using a simple mock approach
      output_lines = []
      mock_formatter = instance_double('Formatter')
      
      # Set up mocks that capture output
      allow(mock_formatter).to receive(:info) do |msg|
        output_lines << msg
      end
      
      allow(mock_formatter).to receive(:success) do |msg|
        output_lines << msg
      end
      
      allow(mock_formatter).to receive(:error) do |msg|
        output_lines << msg
      end
      
      allow(mock_formatter).to receive(:output) do |data, opts = {}|
        output_lines << data.to_s
      end
      
      allow(enterprise_command).to receive(:formatter).and_return(mock_formatter)
      
      # Mock spinner to avoid TTY dependencies
      allow(enterprise_command).to receive(:with_spinner).and_yield
      
      # Execute the billing command
      enterprise_command.billing(enterprise_name)
      
      # Verify that expected output lines are present
      expect(output_lines).to include('=== Enterprise License Consumption ===')
      expect(output_lines).to include('Total seats: 95/100')
      expect(output_lines).to include('Active users: 85')
      
      expect(output_lines).to include("\n=== GitHub Actions Billing ===")
      expect(output_lines).to include('Total minutes used: 15000')
      expect(output_lines).to include('Paid minutes used: 5000')
      expect(output_lines).to include('Included free minutes: 10000')
      expect(output_lines).to include('Percentage of included minutes used: 150.0%')
      
      expect(output_lines).to include('Minutes used by runner type:')
      expect(output_lines).to include('  Ubuntu: 8000')
      expect(output_lines).to include('  Windows: 4000')
      expect(output_lines).to include('  Macos: 3000')
      
      expect(output_lines).to include("\n=== Packages Billing ===")
      expect(output_lines).to include('Total gigabytes bandwidth used: 500')
      
      expect(output_lines).to include("\n=== Shared Storage Billing ===")
      expect(output_lines).to include('Days left in billing cycle: 15')
    end

    it 'handles runner type label capitalization correctly' do
      enterprise_command = Hubctl::Enterprise.new
      
      output_lines = []
      mock_formatter = instance_double('Formatter')
      
      # Set up mocks that capture output
      allow(mock_formatter).to receive(:info) do |msg|
        output_lines << msg
      end
      
      allow(mock_formatter).to receive(:success) do |msg|
        output_lines << msg
      end
      
      allow(mock_formatter).to receive(:error) do |msg|
        output_lines << msg
      end
      
      allow(mock_formatter).to receive(:output) do |data, opts = {}|
        output_lines << data.to_s
      end
      
      allow(enterprise_command).to receive(:formatter).and_return(mock_formatter)
      allow(enterprise_command).to receive(:with_spinner).and_yield
      
      enterprise_command.billing(enterprise_name)
      
      # Verify capitalization is applied correctly (Ubuntu, Windows, Macos)
      runner_lines = output_lines.select { |line| line.start_with?('  ') && line.include?(':') }
      
      expect(runner_lines).to include('  Ubuntu: 8000')
      expect(runner_lines).to include('  Windows: 4000')
      expect(runner_lines).to include('  Macos: 3000')
      
      # Ensure original lowercase keys are not present
      expect(runner_lines).not_to include('  ubuntu: 8000')
      expect(runner_lines).not_to include('  windows: 4000')
      expect(runner_lines).not_to include('  macos: 3000')
    end

    it 'calculates percentage correctly when usage exceeds included minutes' do
      enterprise_command = Hubctl::Enterprise.new
      
      output_lines = []
      mock_formatter = instance_double('Formatter')
      
      # Set up mocks that capture output
      allow(mock_formatter).to receive(:info) do |msg|
        output_lines << msg
      end
      
      allow(mock_formatter).to receive(:success) do |msg|
        output_lines << msg
      end
      
      allow(mock_formatter).to receive(:error) do |msg|
        output_lines << msg
      end
      
      allow(mock_formatter).to receive(:output) do |data, opts = {}|
        output_lines << data.to_s
      end
      
      allow(enterprise_command).to receive(:formatter).and_return(mock_formatter)
      allow(enterprise_command).to receive(:with_spinner).and_yield
      
      enterprise_command.billing(enterprise_name)
      
      # Verify percentage calculation: 15000 / 10000 * 100 = 150.0%
      expect(output_lines).to include('Percentage of included minutes used: 150.0%')
    end
  end

  context 'when some billing APIs are unavailable' do
    before do
      # Set up partial mocks - only licenses and actions work
      allow(@mock_client).to receive(:enterprise_consumed_licenses)
        .with(enterprise_name)
        .and_return({
          total_seats_consumed: 50,
          total_seats_purchased: 100,
          total_advanced_security_committers: 45
        })
      
      allow(@mock_client).to receive(:enterprise_actions_billing)
        .with(enterprise_name)
        .and_return({
          total_minutes_used: 5000,
          total_paid_minutes_used: 1000,
          included_minutes: 10000,
          minutes_used_breakdown: {
            ubuntu: 3000,
            windows: 2000
          }
        })
      
      # These will raise errors (simulating API unavailability)
      allow(@mock_client).to receive(:enterprise_packages_billing)
        .with(enterprise_name)
        .and_raise(StandardError.new('API Error'))
      
      allow(@mock_client).to receive(:enterprise_shared_storage_billing)
        .with(enterprise_name)
        .and_raise(StandardError.new('API Error'))
    end

    it 'continues processing available data and skips unavailable sections' do
      enterprise_command = Hubctl::Enterprise.new
      
      output_lines = []
      mock_formatter = instance_double('Formatter')
      
      # Set up mocks that capture output
      allow(mock_formatter).to receive(:info) do |msg|
        output_lines << msg
      end
      
      allow(mock_formatter).to receive(:success) do |msg|
        output_lines << msg
      end
      
      allow(mock_formatter).to receive(:error) do |msg|
        output_lines << msg
      end
      
      allow(mock_formatter).to receive(:output) do |data, opts = {}|
        output_lines << data.to_s
      end
      
      allow(enterprise_command).to receive(:formatter).and_return(mock_formatter)
      allow(enterprise_command).to receive(:with_spinner).and_yield
      
      enterprise_command.billing(enterprise_name)
      
      # Should have license and actions sections
      expect(output_lines).to include('=== Enterprise License Consumption ===')
      expect(output_lines).to include('Total seats: 50/100')
      expect(output_lines).to include("\n=== GitHub Actions Billing ===")
      expect(output_lines).to include('Total minutes used: 5000')
      expect(output_lines).to include('Percentage of included minutes used: 50.0%')
      
      # Should not have packages or storage sections
      expect(output_lines).not_to include("\n=== Packages Billing ===")
      expect(output_lines).not_to include("\n=== Shared Storage Billing ===")
    end
  end
end
