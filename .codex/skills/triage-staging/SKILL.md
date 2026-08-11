---
name: triage-staging
description: Triage a red main environment for sloop-cli, identify root cause, apply or coordinate the minimal safe repair, and gate sloop resumption on health evidence.
---

# triage-staging

When main is red, pause the dispatcher and set `mainGreen: false`. Gather failing checks, recent changes, logs, and a minimal reproduction; distinguish environment failure from product regression. Run `mainHealthCommand` plus relevant tests. Entry: blocked sloop or failed health. Exit: documented root cause and evidence, then set `mainGreen: true` only after health passes; otherwise remain `blocked`. Do not bypass the gate or claim green on partial signals.
