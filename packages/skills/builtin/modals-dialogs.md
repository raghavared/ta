---
name: modals-dialogs
description: Modal dialogs, drawers, confirmations
triggers:
  taskKinds: [plan.testcases, generate.spec]
  roles: [dialog]
  domHints: [modal, dialog]
---
- Assert the dialog's accessible role/name is visible after opening — not just any text.
- Test closing via the explicit close button; where designs specify, also Escape and backdrop click.
- Assert underlying page state is unchanged after cancel/close.
- Toasts and confirmation banners animate: assert toBeVisible() before asserting text.
