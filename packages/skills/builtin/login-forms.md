---
name: login-forms
description: Testing sign-in forms — happy path, invalid credentials, field retention
triggers:
  taskKinds: [plan.testcases, generate.spec]
  urlKeywords: [login, signin, sign-in, auth]
  roles: [textbox]
---
- Always test both the happy path AND invalid credentials; the error path is where regressions hide.
- After a failed sign-in, assert the user stays on the sign-in page and the error message is visible.
- Assert entered values are retained after failure (common UX regression).
- Never hard-code real credentials in specs; the login helper handles auth.
- Assert the post-login landmark (greeting, avatar, dashboard heading) — not just URL change.
