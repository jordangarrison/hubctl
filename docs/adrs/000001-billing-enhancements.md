# ADR-000001: Enhanced GitHub Actions Billing with Utilization Tracking and Runner Breakdowns

## Status

Accepted

## Context

The existing `hubctl enterprise billing` command provided basic GitHub Actions billing information but lacked detailed insights that would help enterprise administrators:

1. **Limited Utilization Visibility**: No indication of how much of the included quota was being used
2. **Missing Cost Breakdown**: No breakdown by runner type (Ubuntu, Windows, macOS) to understand cost drivers
3. **No Overage Insights**: When exceeding included minutes, no cost estimation or detailed analysis
4. **Poor Actionability**: Raw numbers without context made it difficult to make informed decisions

The GitHub API provides rich billing data including `total_minutes_used`, `total_paid_minutes_used`, `included_minutes`, and `minutes_used_breakdown` that was underutilized in the original implementation.

## Decision

We will enhance the billing display to provide comprehensive utilization tracking and cost analysis:

### 1. Utilization Tracking
- Calculate and display utilization percentage of included minutes
- Show remaining included minutes in the current billing cycle
- Provide clear visual indication of quota status

### 2. Runner Type Breakdown
- Display detailed minutes breakdown by runner type (Ubuntu, Windows, macOS)
- Show percentage distribution of usage across runner types
- Sort runners by usage (highest first) for better readability
- Validate breakdown totals against reported totals

### 3. Cost Estimation
- Estimate additional costs when paid minutes are used
- Apply current GitHub Actions pricing:
  - Ubuntu/Linux: $0.008 per minute
  - Windows: $0.016 per minute
  - macOS: $0.08 per minute
- Distribute overage costs proportionally based on runner type usage

### 4. Enhanced Output Format
```
=== Actions Billing ===
Total minutes used: 120
Paid minutes used: 30
Included minutes: 2000
Included minutes used: 90 (4.5% utilization)
Remaining included minutes: 1910

--- Runner Type Breakdown ---
  UBUNTU: 110 minutes (91.67%)
  WINDOWS: 10 minutes (8.33%)

--- Usage Summary ---
Exceeded included quota by: 30 minutes
Estimated additional cost: $0.25
```

## Implementation

### Changes Made
1. **Enhanced billing method** in `lib/hubctl/enterprise.rb`
   - Added utilization percentage calculations
   - Implemented runner type breakdown with sorting
   - Added cost estimation functionality

2. **New private method**: `calculate_estimated_cost(breakdown, paid_minutes)`
   - Proportional distribution of overage costs by runner type
   - Current GitHub Actions pricing incorporated
   - Handles edge cases (zero usage, missing breakdown data)

### API Integration
The implementation leverages the existing GitHub API endpoint `GET /enterprises/:enterprise/settings/billing/actions` which returns:
```json
{
  "total_minutes_used": 120,
  "total_paid_minutes_used": 30,
  "included_minutes": 2000,
  "minutes_used_breakdown": {
    "UBUNTU": 110,
    "MACOS": 0,
    "WINDOWS": 10
  }
}
```

## Consequences

### Positive
- **Better Cost Visibility**: Users can see exactly what they're spending and why
- **Usage Optimization**: Runner type breakdown helps identify optimization opportunities (e.g., switching from macOS to Ubuntu runners where possible)
- **Proactive Management**: Utilization tracking helps prevent surprise billing
- **Actionable Insights**: Cost estimates and remaining quota help with budgeting and planning
- **Backward Compatibility**: All existing functionality is preserved

### Negative
- **Increased Complexity**: More calculation logic in the billing display method
- **Pricing Dependency**: Cost estimates depend on hardcoded GitHub pricing that may change
- **Additional Processing**: More data processing for breakdown analysis

### Neutral
- **Output Length**: Enhanced output is longer but more informative
- **Maintenance**: Requires occasional updates to pricing information

## Alternatives Considered

1. **Separate Commands**: Creating separate commands for utilization and breakdown
   - Rejected: Would fragment the billing experience
   
2. **Optional Flags**: Making enhanced output opt-in via flags
   - Rejected: The enhanced information is always valuable
   
3. **External Pricing API**: Fetching current pricing from GitHub
   - Rejected: Adds complexity and external dependency for estimates

## Future Considerations

- Monitor GitHub pricing changes and update accordingly
- Consider adding historical trend analysis
- Evaluate adding budget alerts/warnings
- Assess value of adding organization-level breakdown within enterprise

## References

- [GitHub Actions Billing API Documentation](https://docs.github.com/en/rest/enterprise-admin/billing)
- [GitHub Actions Pricing](https://docs.github.com/en/billing/managing-billing-for-github-actions/about-billing-for-github-actions)
- Original implementation in `lib/hubctl/enterprise.rb` lines 313-318
