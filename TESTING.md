# Testing

This project uses RSpec for testing. The test suite includes unit tests and smoke tests for the enterprise billing functionality.

## Running Tests

### All Tests
```bash
bundle exec rspec
# or
bundle exec rake spec
```

### Enterprise Billing Tests Only
```bash
bundle exec rake spec:enterprise_billing
```

### Smoke Tests Only
```bash
bundle exec rake spec:smoke
```

## Test Structure

### Unit Tests (`spec/unit/enterprise_billing_spec.rb`)
Tests the `Hubctl::Enterprise#billing` method with proper mocking of:
- GitHub API client methods
- Formatted output verification
- Error handling scenarios
- Authentication failure cases

### Smoke Tests (`spec/unit/enterprise_billing_smoke_spec.rb`)
End-to-end tests that:
- Mock the entire GitHub client
- Execute the full billing command
- Verify expected output lines are produced
- Test runner type label capitalization
- Test percentage calculations
- Test partial API failures

## Key Test Features

1. **Mocked GitHub API**: All tests use mocked GitHub API responses to avoid real API calls
2. **Output Verification**: Tests verify that correct billing information is displayed with proper labels
3. **Error Handling**: Tests ensure the command gracefully handles API failures
4. **Runner Breakdown**: Tests verify that runner types are properly capitalized (Ubuntu, Windows, Macos)
5. **Calculations**: Tests verify percentage calculations are correct

## Test Data

Sample test data is provided via helper methods in `spec/support/github_client_helpers.rb`:
- `sample_enterprise_actions_billing_payload`
- `sample_enterprise_consumed_licenses_payload`
- `sample_enterprise_packages_billing_payload`
- `sample_enterprise_storage_billing_payload`

## Coverage

Test coverage reports are generated using SimpleCov and saved to the `coverage/` directory.
