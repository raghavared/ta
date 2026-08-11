---
name: comboboxes
description: Native selects and custom dropdown components
triggers:
  taskKinds: [plan.testcases, generate.spec]
  roles: [combobox]
---
- Native <select>: use selectOption with the option VALUE, then assert the visible selected label.
- Custom dropdowns (Radix/React-Select): click to open, assert the listbox appears, click the option,
  assert the trigger shows the chosen label and the listbox closed.
- Test that selecting is reflected in the submitted result, not just the widget state.
- If a default/placeholder option exists, assert submitting without a choice behaves per spec.
