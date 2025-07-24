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
      output: nil,
      json?: false
    )
    allow(enterprise_command).to receive(:formatter).and_return(@mock_formatter)
    
    # Mock the spinner methods
    allow(enterprise_command).to receive(:with_spinner).and_yield
  end

  describe 'when fetching billing information successfully' do
    let(:sample_usage_items_payload) do
      {
        usageItems: [
          {
            product: 'actions',
            sku: 'Actions Linux',
            unitType: 'Minutes', 
            quantity: 1000,
            netAmount: 8.0
          },
          {
            product: 'actions',
            sku: 'Actions Windows',
            unitType: 'Minutes',
            quantity: 500,
            netAmount: 8.0
          },
          {
            product: 'packages',
            sku: 'packages-storage',
            unitType: 'GB-hours',
            quantity: 100,
            netAmount: 2.0
          },
          {
            product: 'copilot',
            sku: 'copilot-business',
            unitType: 'user-months',
            quantity: 10,
            netAmount: 190.0
          }
        ]
      }
    end

    before do
      allow(mock_github_client).to receive(:enterprise_actions_billing)
        .with(enterprise_name)
        .and_return(sample_usage_items_payload)
    end

    context 'when output format is table (default)' do
      it 'outputs flattened billing data as table' do
        enterprise_command.billing(enterprise_name)
        
        expect(@mock_formatter).to have_received(:output).with(
          array_including(
            hash_including(category: 'Enterprise', metric: 'Name', value: enterprise_name),
            hash_including(category: 'Enterprise', metric: 'Total Cost', value: '$208.0'),
            hash_including(category: 'Actions', metric: 'Total Minutes', value: '1500'),
            hash_including(category: 'Actions', metric: 'Total Cost', value: '$16.0'),
            hash_including(category: 'Actions - Actions Linux', metric: 'Minutes (Share)', value: '1000 (0%)'),
            hash_including(category: 'Actions - Actions Linux', metric: 'Cost', value: '$8.0'),
            hash_including(category: 'Actions - Actions Windows', metric: 'Minutes (Share)', value: '500 (0%)'),
            hash_including(category: 'Actions - Actions Windows', metric: 'Cost', value: '$8.0'),
            hash_including(category: 'Packages', metric: 'Storage (GB-hours)', value: '100'),
            hash_including(category: 'Packages', metric: 'Data Transfer (GB)', value: '0'),
            hash_including(category: 'Packages', metric: 'Total Cost', value: '$2.0'),
            hash_including(category: 'Copilot', metric: 'User-Months', value: '10'),
            hash_including(category: 'Copilot', metric: 'Total Cost', value: '$190.0')
          ),
          headers: %w[category metric value]
        )
      end
    end

    context 'when output format is JSON' do
      before do
        allow(@mock_formatter).to receive(:json?).and_return(true)
      end

      it 'outputs structured billing data as JSON' do
        enterprise_command.billing(enterprise_name)
        
        expect(@mock_formatter).to have_received(:output).with(
          hash_including(
            enterprise: enterprise_name,
            total_cost: 208.0,
            actions: hash_including(
              total_minutes: 1500,
              total_cost: 16.0,
              runner_breakdown: hash_including(
                'Actions Linux' => hash_including(minutes: 1000, cost: 8.0),
                'Actions Windows' => hash_including(minutes: 500, cost: 8.0)
              )
            ),
            packages: hash_including(
              total_cost: 2.0,
              total_storage_gb_hours: 100,
              total_data_transfer_gb: 0
            ),
            copilot: hash_including(
              total_cost: 190.0,
              total_user_months: 10
            )
          )
        )
      end
    end
  end

  describe 'when no usage data is available' do
    before do
      allow(mock_github_client).to receive(:enterprise_actions_billing)
        .with(enterprise_name)
        .and_return({ usageItems: [] })
    end

    it 'shows no billing data message and returns early' do
      enterprise_command.billing(enterprise_name)
      
      expect(@mock_formatter).to have_received(:info).with("No billing usage data found for enterprise #{enterprise_name}")
      expect(@mock_formatter).not_to have_received(:output)
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
      
      # Mock billing method to raise API error
      allow(mock_github_client).to receive(:enterprise_actions_billing)
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
