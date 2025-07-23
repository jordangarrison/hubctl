# frozen_string_literal: true

require 'simplecov'
SimpleCov.start do
  add_filter '/spec/'
  add_filter '/vendor/'
end

require 'bundler/setup'
require_relative '../lib/hubctl'

# Load support files
Dir[File.join(__dir__, 'support', '**', '*.rb')].each { |f| require f }

RSpec.configure do |config|
  # Enable flags like --only-failures and --next-failure
  config.example_status_persistence_file_path = ".rspec_status"

  # Disable RSpec exposing methods globally on Module and main
  config.disable_monkey_patching!

  config.expect_with :rspec do |c|
    c.syntax = :expect
  end

  # Allow focused tests
  config.filter_run_when_matching :focus

  # Randomize test order
  config.order = :random
  Kernel.srand config.seed

  # Capture stdout/stderr for testing output
  config.before(:each) do
    @original_stdout = $stdout
    @original_stderr = $stderr
    $stdout = StringIO.new
    $stderr = StringIO.new
  end

  config.after(:each) do
    $stdout = @original_stdout
    $stderr = @original_stderr
  end

  # Helper method to get captured output
  def captured_output
    $stdout.string
  end

  def captured_error
    $stderr.string
  end
end
