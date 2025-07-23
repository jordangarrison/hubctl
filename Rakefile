# frozen_string_literal: true

require 'bundler/gem_tasks'
require 'rspec/core/rake_task'

# Default RSpec task
RSpec::Core::RakeTask.new(:spec)

# Run just the enterprise billing tests
RSpec::Core::RakeTask.new('spec:enterprise_billing') do |t|
  t.pattern = 'spec/unit/enterprise_billing_spec.rb'
end

# Run just the smoke tests
RSpec::Core::RakeTask.new('spec:smoke') do |t|
  t.pattern = 'spec/unit/enterprise_billing_smoke_spec.rb'
end

# Set default task
task default: :spec
