# Implementation Review Playbook

## Scope

This playbook applies only to the Refactoring v1.2 audit and implementation workflow. It does not establish a permanent Sloop-wide review policy or require a Review subagent for future work. Christian and Codex decide whether to reuse it in later efforts.

## Purpose and boundaries

The Review subagent is an independent correctness check between implementation and E2E verification. It checks the issue's acceptance criteria, relevant behavior and regressions, PR scope, engineering standards, and implementation evidence.

The reviewer is not a second implementer, an adversarial nitpicker, or a replacement for repository QA, CI, or E2E. The reviewer must not silently waive an acceptance criterion or claim that an absent check passed.

## Review inputs

The Orchestrator provides:

- The issue and its acceptance criteria.
- The PR, base SHA, and exact head SHA to review.
- The implementation diff and relevant dependency context.
- Worker evidence: required commands, exit codes, relevant results, and tested SHA.
- Applicable CI status, or an explicit note that no checks were reported.

The reviewer confirms that the evidence applies to the exact PR head under review.
Before recording an outcome, the reviewer checks the PR head again. A changed head invalidates the review outcome and requires review of the new head.

## Review procedure

The reviewer maps each acceptance criterion to the changed behavior and supporting evidence. They inspect relevant call paths and regression risks, confirm that the diff stays within scope, and compare verification evidence with repository instructions.

The reviewer records one of these outcomes:

- **PASS:** All acceptance criteria are met and required verification is supported by evidence for the reviewed SHA.
- **CHANGES REQUESTED:** An actionable gap needs an implementation change or new evidence.
- **BLOCKED:** Progress requires a human decision, an unresolved dependency, or a required gate that cannot be completed.

If GitHub reports no checks, record **“no checks reported.”** Do not describe missing CI as passing or green. If no remote check is required, assess the required repository verification from Worker evidence and report CI status separately. A required check that is missing, pending, or failing prevents `PASS`.
If a required check is still running, wait without starting a re-review round. If a required check is unavailable or cannot be completed, record `BLOCKED` and escalate. Missing or unclear evidence that the implementer can supply is `CHANGES REQUESTED`.

## Findings

Each blocking finding identifies:

- The affected acceptance criterion or contract.
- The location in the diff, or the missing evidence/check when no code location applies.
- The expected and observed behavior.
- The evidence and impact.
- What would demonstrate that it is resolved.

Block on correctness, acceptance, scope, regression, or required-verification gaps. Cosmetic preferences without user impact are non-blocking observations. Do not expand the review into unrelated cleanup.
The implementer may challenge a finding with evidence. The reviewer decides whether that evidence resolves it; a persistent disagreement or unclear acceptance criterion is escalated to Christian rather than silently waived.

## Correction and re-review loop

For `CHANGES REQUESTED`, the Implementer addresses each actionable finding or supplies evidence-based reasoning that it is not valid. They update the PR and Worker evidence for the new head SHA, then request re-review.

The reviewer checks the fixes, affected behavior, relevant acceptance criteria, and any new regressions. `PASS` is recorded only against the exact current head SHA reviewed. Every re-review requested after `CHANGES REQUESTED` consumes one correction round, whether the response changes code or supplies evidence on the same SHA. Waiting for required CI before starting a re-review does not consume a round. Review `PASS` completes this role only; any required E2E gate still has to pass before the issue advances.

**Approved limit for Refactoring B1.2: one initial review plus at most two correction and re-review rounds per issue.** The limit is shared across all findings and does not reset when the SHA changes or new findings appear. Every re-review after `CHANGES REQUESTED` consumes a round, including evidence-only replies on the same SHA. Waiting for required CI does not consume a round. Escalate sooner if criteria conflict or a human decision is required.

If actionable findings remain after the two rounds, pause the issue and retain the PR, SHAs, unresolved findings, evidence, attempts, verification and CI status, and affected dependencies. Escalate to Christian to resolve or explicitly defer the issue. A deferral is not a `PASS`; do not run E2E for a blocked issue.

## Continuing other issues

A later issue may proceed while another issue is blocked only if it has no direct or transitive dependency on the blocked changes and can be isolated from that PR. Use the last accepted base SHA (the latest base already authorized by the workflow gates); do not stack on the blocked head. Record that SHA and why the later issue is independent. If the base or dependency is uncertain, pause the later issue too.

## Examples

**Resolved finding:** The reviewer finds that a changed command no longer returns a value required by an acceptance criterion. The Implementer restores it, adds an observable assertion, and provides required repository verification for the new SHA. The reviewer confirms the criterion and evidence, records `PASS`, and the issue proceeds to E2E.

**Unresolved finding:** The same behavior remains missing after two correction rounds. The reviewer records `BLOCKED`, preserves both attempts and their evidence, and escalates to Christian. Dependent work stays paused; independent work may proceed only under the isolation rules above.

**Independent issue:** Issue B is blocked on PR head `B2`. The Orchestrator verifies that issue C has no direct or transitive dependency on B, records the last accepted base SHA and that dependency check, and branches C from that accepted base rather than `B2`.

## Rollout

The Refactoring v1.2 milestone links this playbook before the initial audit batch in issue #193. Do not launch the external Orchestrator until Christian has reviewed the audit issues, selected models and reasoning effort, and explicitly authorized launch.
