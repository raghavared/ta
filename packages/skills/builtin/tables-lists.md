---
name: tables-lists
description: Lists, tables, pagination, empty states
triggers:
  taskKinds: [plan.testcases, generate.spec]
  roles: [list, listitem, table, row]
---
- After adding an item, assert the NEW item's text appears — not just that the count changed.
- Prefer role/text-scoped row lookups over nth-child (rows reorder).
- Dynamic ids in list-item testids (item-123) are unstable; anchor on the item's visible text.
- Where an empty state exists, plan a case for it — empty states are chronically undertested.
