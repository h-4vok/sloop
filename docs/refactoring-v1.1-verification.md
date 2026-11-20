# Refactoring v1.1 verification ledger

## Current-main baseline (2026-11-20)

The ledger was last updated by [PR #181](https://github.com/h-4vok/sloop/pull/181), merged on 2026-11-02. PR #182 later promoted the stacked refactoring changes to `main`; as of this baseline, PRs #163–#182 are merged. The historical claims below describe their October 31 review snapshot, not current merge state.

### Source checkout

- Tested `main` SHA: `1628f0f7df226dcf3ff0c0e6083577eecd5ef9dc`, matching `origin/main`.
- `npm run build`: passed.
- Global `sloop` link resolves to `C:\src\sloop`; `sloop --version` returned `1.7.0`.
- `npm run pr-checks`: exit 0. Tests: 672 passed, 1 skipped. Coverage: statements 97.15%, branches 89.04%, functions 100% (1442/1442), lines 98.94%. Final build passed.

### Three Sloop Test Empty cycles

The existing five-cycle skill was run unchanged and stopped after the three successful cycles at the user's direction. Each successful cycle had one Worker `ready_for_review` comment and one QA round 1 `passed` comment for the PR head, changed only root-level `MANUAL-E2E.md` to the exact one-line content `sloop-e2e-ok`, and reached `ready_for_human_merge`. Each PR was mergeable against `main` and remained unmerged. GitHub reported **no checks** for all three fixture PRs; missing checks are not a green CI result.

| Cycle | Fixture issue                                                 | Fixture PR                                                  | Head SHA                                   | Worker           | QA             | Sloop status          | CI                 |
| ----- | ------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------ | ---------------- | -------------- | --------------------- | ------------------ |
| 1     | [#162](https://github.com/h-4vok/sloop-test-empty/issues/162) | [#163](https://github.com/h-4vok/sloop-test-empty/pull/163) | `8a3e0ba478c5fb41eb0327ac559422165d6a5091` | ready_for_review | round 1 passed | ready_for_human_merge | no checks reported |
| 2     | [#164](https://github.com/h-4vok/sloop-test-empty/issues/164) | [#165](https://github.com/h-4vok/sloop-test-empty/pull/165) | `6fb82c9cb3e495863ec020b3552a5c36995aec00` | ready_for_review | round 1 passed | ready_for_human_merge | no checks reported |
| 3     | [#166](https://github.com/h-4vok/sloop-test-empty/issues/166) | [#167](https://github.com/h-4vok/sloop-test-empty/pull/167) | `de311ca2c9cb3b667be1603d5a88ed581e1a6b56` | ready_for_review | round 1 passed | ready_for_human_merge | no checks reported |

### Interrupted fourth attempt and fixture cleanup

After cycle 3, issue [#168](https://github.com/h-4vok/sloop-test-empty/issues/168) was opened as the next attempt. At the user's direction, the active Sloop command was interrupted while the issue was in `worker_recovery_pending`; no PR or successful Worker/QA evidence was produced, so this attempt is not counted as a cycle. The dedicated cleanup procedure closed issue #168 and removed its E2E labels.

Final fixture verification: repository `h-4vok/sloop-test-empty`, branch `main`, clean worktree, Sloop `idle`, zero open `Sloop E2E` issues or PRs, and zero local or remote `codex/issue-*` branches. `sloop --clear-all-worktrees` and `sloop --reset` both completed successfully. No fixture PR was merged.

## Historical snapshot (2026-10-31)

The following records the state at the earlier review snapshot. At that point the five final cycles ran against the accumulated `codex/loop/v1.1-refactoring-155` checkout because later milestone PRs were still open. The listed open PR state and pending post-merge verification are historical and have since been superseded by the current-main baseline above.

### Local verification at the historical snapshot

- Final code snapshot tested: `596c123f04969b6ba6799ef093ca4ce95d20fe9a` on `codex/loop/v1.1-refactoring-155`.
- `npm run pr-checks`: passed. Test run: 672 passed, 1 skipped. Coverage: statements 97.15%, branches 89.04%, functions 100% (1442/1442), lines 98.94%. Final TypeScript build passed.
- `npm run link:local`: passed. Global `sloop` package junction targeted `C:\src\sloop`; `sloop --version` returned `1.6.0`.

### Five final Sloop Test Empty cycles at the historical snapshot

GitHub reported **no checks** for every fixture PR; this was not a green CI result.

| Cycle | Fixture issue                                                 | Fixture PR                                                  | Head SHA                                   | Worker           | QA             | Sloop status          | CI                 |
| ----- | ------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------ | ---------------- | -------------- | --------------------- | ------------------ |
| 1     | [#132](https://github.com/h-4vok/sloop-test-empty/issues/132) | [#133](https://github.com/h-4vok/sloop-test-empty/pull/133) | `c4f930f560551a1df0a9e4724c9f91426d1a9bff` | ready_for_review | round 1 passed | ready_for_human_merge | no checks reported |
| 2     | [#134](https://github.com/h-4vok/sloop-test-empty/issues/134) | [#135](https://github.com/h-4vok/sloop-test-empty/pull/135) | `1a8781771045c70fdfe879e824888510ed04b6aa` | ready_for_review | round 1 passed | ready_for_human_merge | no checks reported |
| 3     | [#136](https://github.com/h-4vok/sloop-test-empty/issues/136) | [#137](https://github.com/h-4vok/sloop-test-empty/pull/137) | `ee624e08fba695e3178056feaa9edb1e79bf6991` | ready_for_review | round 1 passed | ready_for_human_merge | no checks reported |
| 4     | [#138](https://github.com/h-4vok/sloop-test-empty/issues/138) | [#139](https://github.com/h-4vok/sloop-test-empty/pull/139) | `b26cbdb9ce60128319f6c91294eb5d5b91bcbb9d` | ready_for_review | round 1 passed | ready_for_human_merge | no checks reported |
| 5     | [#140](https://github.com/h-4vok/sloop-test-empty/issues/140) | [#141](https://github.com/h-4vok/sloop-test-empty/pull/141) | `88b4686615d93f26868337ad265b336966f95471` | ready_for_review | round 1 passed | ready_for_human_merge | no checks reported |

The preliminary cycle after #154 (fixture issue #130 / PR #131, SHA `8e2a9ea0392108f79e408569cb308f170903ae55`) was context only and was not counted above.

### Fixture cleanup at the historical snapshot

After each historical final cycle, its test PR and issue were closed without merging. The fixture was verified on `main` with a clean worktree, Sloop `idle`, zero open E2E issues or PRs, and zero local or remote `codex/issue-*` branches. `sloop --clear-all-worktrees` and `sloop --reset` completed successfully. E2E automation was disabled.

### GitHub CI and merge state at the historical snapshot

GitHub returned empty `statusCheckRollup` for the milestone PRs in that review, so CI could not be claimed green from GitHub evidence. PRs #157–#162 were recorded as merged, while PRs #163–#181 were recorded as open and clean at that snapshot. PR #182 later promoted the stacked changes to `main` on 2026-11-02; that historical open state and the pending post-merge statement no longer describe current `main`.
