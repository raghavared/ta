---
name: date-pickers
description: Date inputs and calendar pickers
triggers:
  taskKinds: [plan.testcases, generate.spec]
  domHints: [date, calendar]
---
- Native input[type=date]: fill with ISO format (yyyy-mm-dd) regardless of the display format.
- Custom calendars: prefer typing when supported; otherwise navigate months explicitly before clicking a day.
- Test min/max clamping when the field declares bounds.
- Displayed dates are locale-formatted: assert with a tolerant matcher, not a hard-coded locale string.
