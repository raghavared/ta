---
name: status-gated-actions
description: Buttons enabled only after a state/status change (workflow gates)
triggers:
  taskKinds: [plan.testcases, generate.spec]
  roles: [button]
  domHints: [disabled]
---
- When a button is disabled until a status changes, test the GATE itself, not just the click:
  assert toBeDisabled() before the precondition, then toBeEnabled() after.
- After the gated action fires, assert the resulting status text AND that spent actions become disabled.
- Status transitions may be async — use web-first assertions (toBeEnabled polls), never waitForTimeout.
- Add a negative case where feasible: the action must be impossible before the precondition.
