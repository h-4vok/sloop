# Graph Report - .  (2026-08-24)

## Corpus Check
- Corpus is ~19,927 words - fits in a single context window. You may not need a graph.

## Summary
- 245 nodes · 437 edges · 17 communities (12 shown, 5 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 18 edges (avg confidence: 0.67)
- Token cost: 8,697 input · 1,154 output

## Community Hubs (Navigation)
- Dispatcher orchestration
- Config registry
- Package metadata
- Integration adapters
- Core interfaces
- TypeScript tooling
- Lock recovery
- CLI capabilities
- Sloop documentation
- Formatting
- Dispatcher tests
- CLI bootstrap
- Delivery artifacts
- CLI tests
- Config tests
- Contribution guide

## God Nodes (most connected - your core abstractions)
1. `productionDependencies()` - 18 edges
2. `Deps` - 16 edges
3. `dispatch()` - 16 edges
4. `runWorker()` - 14 edges
5. `resolveReviewCap()` - 12 edges
6. `scripts` - 11 edges
7. `parseConfig()` - 11 edges
8. `linkIssueToActiveRun()` - 11 edges
9. `fail()` - 10 edges
10. `CliControl` - 10 edges

## Surprising Connections (you probably didn't know these)
- `Worker Skill` --references--> `Sloop README`  [INFERRED]
  .codex/skills/worker/SKILL.md → README.md
- `Sloop Configuration` --references--> `PR Checks Workflow`  [EXTRACTED]
  sloop.config.yaml → .github/workflows/pr-checks.yml
- `Sloop Engineering V1 Operation` --references--> `PR Checks Workflow`  [EXTRACTED]
  docs/sloop-engineering-v1.md → .github/workflows/pr-checks.yml
- `Dispatcher Skill` --calls--> `Triage Staging Skill`  [INFERRED]
  .codex/skills/dispatcher/SKILL.md → .codex/skills/triage-staging/SKILL.md
- `productionDependencies()` --indirect_call--> `commentPullRequest()`  [INFERRED]
  src/adapters.ts → src/dispatcher.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Sloop Sequential Engineering Flow** — codex_skills_product_lead_skill, codex_skills_dispatcher_skill, codex_skills_worker_skill, codex_skills_qa_sdet_skill, codex_skills_staff_reviewer_skill [EXTRACTED 1.00]
- **Sloop Verification Stack** — github_workflows_pr_checks, codex_skills_qa_sdet_skill, codex_skills_staff_reviewer_skill [EXTRACTED 0.95]

## Communities (17 total, 5 thin omitted)

### Community 0 - "Dispatcher orchestration"
Cohesion: 0.08
Nodes (54): acquire(), activeRunForHitl(), argumentValues(), Check, checkFeedback(), claimNewIssue(), command, Config (+46 more)

### Community 1 - "Config registry"
Cohesion: 0.09
Nodes (42): allowedTree(), argvListParser(), argvParser(), booleanParser(), canonicalConfigYaml(), ConfigDiagnostic, configFingerprint(), ConfigValidationError (+34 more)

### Community 2 - "Package metadata"
Cohesion: 0.06
Nodes (31): @openai/codex, bin, sloop, dependencies, @openai/codex, yaml, devDependencies, prettier (+23 more)

### Community 3 - "Integration adapters"
Cohesion: 0.16
Nodes (27): productionDependencies(), checkoutWorkerBranch(), childProcessInvocation(), commentIssueOnce(), commentPullRequest(), commentPullRequestOnce(), defaultProcessAlive(), dispatcherLockPath() (+19 more)

### Community 4 - "Core interfaces"
Cohesion: 0.09
Nodes (8): AgentRunner, GitHubProvider, GitProvider, HealthGate, LockOwner, RunEventSink, Scheduler, Workspace

### Community 5 - "TypeScript tooling"
Cohesion: 0.17
Nodes (11): src/**/*.ts, compilerOptions, esModuleInterop, module, moduleResolution, outDir, rootDir, skipLibCheck (+3 more)

### Community 8 - "Sloop documentation"
Cohesion: 0.33
Nodes (7): Dispatcher Skill, Product Lead Skill, QA/SDET Skill, Staff Reviewer Skill, Triage Staging Skill, Worker Skill, Sloop README

### Community 9 - "Formatting"
Cohesion: 0.33
Nodes (5): endOfLine, printWidth, semi, singleQuote, trailingComma

### Community 10 - "Dispatcher tests"
Cohesion: 0.50
Nodes (3): baseConfig, existingHumanReviewGuide(), harness()

### Community 11 - "CLI bootstrap"
Cohesion: 0.67
Nodes (3): packageJson, requireSupportedNode(), runCli()

### Community 12 - "Delivery artifacts"
Cohesion: 0.67
Nodes (3): Sloop Engineering V1 Operation, PR Checks Workflow, Sloop Configuration

## Knowledge Gaps
- **65 isolated node(s):** `singleQuote`, `trailingComma`, `semi`, `printWidth`, `endOfLine` (+60 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `LockStore` connect `Lock recovery` to `Dispatcher orchestration`, `Core interfaces`?**
  _High betweenness centrality (0.034) - this node is a cross-community bridge._
- **Why does `CliControl` connect `CLI capabilities` to `Dispatcher orchestration`, `Core interfaces`?**
  _High betweenness centrality (0.030) - this node is a cross-community bridge._
- **Why does `GitHubProvider` connect `Core interfaces` to `Dispatcher orchestration`, `Integration adapters`?**
  _High betweenness centrality (0.023) - this node is a cross-community bridge._
- **Are the 7 inferred relationships involving `productionDependencies()` (e.g. with `commentPullRequest()` and `defaultProcessAlive()`) actually correct?**
  _`productionDependencies()` has 7 INFERRED edges - model-reasoned connections that need verification._
- **What connects `singleQuote`, `trailingComma`, `semi` to the rest of the system?**
  _65 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Dispatcher orchestration` be split into smaller, more focused modules?**
  _Cohesion score 0.07792207792207792 - nodes in this community are weakly interconnected._
- **Should `Config registry` be split into smaller, more focused modules?**
  _Cohesion score 0.08773784355179703 - nodes in this community are weakly interconnected._