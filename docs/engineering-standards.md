# Sloop Engineering & Architectural Standards

## 1. Object-Oriented & Structural Design
- **OOP Priority:** Structure code around well-defined components, classes, and objects rather than loose procedural functions.
- **Classes (`class`):** Use strictly for components requiring multiple instances and internal mutable state management.
- **Literal Objects / Modules:** Use exported literal objects (`export const ...`) for singletons, services, adapters, or domain orchestrators with a controlled lifecycle.
- **Loose Functions (Exception):** Isolated functions are permitted exclusively for extremely small, self-contained mathematical helpers or formatters. Everything else must be encapsulated within classes or objects.
- **Barrel Exports & Structure:** Group related utilities in dedicated folders and expose them cleanly via an `index.ts` file at the root of that folder.

## 2. SOLID Principles & Single Responsibility (SRP)
- **SRP at All Levels:** The single responsibility principle applies strictly to files, classes, methods, and functions. A unit of code must have one and only one reason to change.
- **Coupling & Cohesion:** Keep components decoupled. Dependencies must be injected, and infrastructure responsibilities (I/O, network, processes) must be cleanly separated from pure business logic.

## 3. Error Handling (Result Pattern)
- **Result Types:** Domain logic must never throw raw exceptions (`throw`) for expected control flow or domain errors. Instead, return structured `Result<T, E>` types.
- **Boundary Exceptions:** Exceptions (`throw` / `CliFailure`) are strictly reserved for unrecoverable bootstrap failures and external system boundaries (CLI entrypoints).

## 4. Extensible State Management (Mixins)
- **Core State Minimalism:** The global `State` object must remain minimal and agnostic of specific roles (`issue`, `pr`, `baseSha`, `reviewRound`, `updatedAt`).
- **Role Mixins:** Dynamic agents and roles must inject their specific data extensions via modular extension properties (e.g., `roleData?: Record<string, unknown>`), preventing core refactors when new roles are added.

## 5. Immutability & Variable Declaration
- **Const-First Policy:** Use `const` by default for all declarations. Use `let` *only* when local reassignment is strictly necessary. `var` is completely banned.
- **Strict Immutability:** Enforce `readonly` modifiers on arrays and object properties wherever mutation is not intended.

## 6. Code Layout & Visual Separation
- **Vertical Spacing:** Separate declarations and cohesive blocks that address different concepts or problems with a blank line. Keep statements that belong to the same block together, and use spacing to make changes in responsibility clear.

## 7. Naming Conventions & Domain Language
- **Domain Language:** Names must reflect the actual business domain of the project (e.g., `issue`, `pr`, `dispatch`, `worker`, `qa`). Avoid vague or generic names like `data`, `process`, `handle`, or `run`.
- **Booleans:** Must be prefixed with semantic action/state identifiers: `is`, `has`, `should`, `can` (e.g., `isValid`, `hasPermission`).
- **Functions & Methods:** Must follow an imperative `Verb + Noun` structure that clearly describes the action and target (e.g., `fetchIssueData`, `validateWorkflowState`).
- **Collections / Arrays:** Must be pluralized or explicitly suffixed (e.g., `activeSessions`, `errorList`).

## 8. Modern Unit Testing Standard
- **Test Runner (Vitest):** Use **Vitest** as the official test runner for its extreme speed, native TypeScript/ESM support, and instant feedback loop.
- **AAA Pattern (Arrange, Act, Assert):** Every test must explicitly separate its phases using blank lines. Keep setup together, leave a blank line before the action, and leave another blank line before assertions. When a phase has distinct concepts, separate those with blank lines too.
  1. *Arrange:* Set up named inputs, mock responses, initial state, and injected dependencies.
  2. *Act:* Call the behavior under test and assign its result to a descriptive variable.
  3. *Assert:* Compare the result with the expected outcome.
- **Named Test Values:** Give arrays and objects that represent test inputs, mock responses, or expected objects descriptive `const` names before passing them to a function or assertion. Use names such as `dispatcherArgs`, `mockIssueResponse`, and `expectedCommand`. Keep primitive expected values (such as a number, string, or boolean) inline when that stays clear.
- **Readable Calls:** Break multi-step expressions into named intermediate values. For example, create a manifest, pass it to the marker builder, and store the marker in separate statements. Keep a simple, familiar expression inline when its meaning is obvious (for example, joining a temporary directory with a fixed suffix).
- **Explicit Mocks:** Name mocks and their returned fixtures for the boundary and behavior they represent, such as `mockGitHubCommand`, `mockPullRequestResponse`, or `mockReviewThreadsResponse`. Avoid opaque abbreviations such as `h` or `deps`, and avoid making readers infer what a callback branch or response fixture represents.
- **Mock Clarity:** When a mock routes several commands or returns a complex protocol response, make each route and response understandable from its names. Add a brief comment to explain the scenario or protocol relationship only when names and structure are not enough. Comments should explain why a complex fixture exists, not narrate obvious code. If the setup still takes substantial effort to understand, split the test into smaller behavior-focused tests.
- **Comment Spacing:** Put a blank line before and after a comment block that introduces or explains a separate concept, including when the comment is followed by only a short piece of code. Keep the comment close enough to make its subject clear.
- **Integration-Style Setup:** When a test creates real temporary repositories, processes, or filesystem state, explain the purpose of that setup if it is not obvious. Separate the fixture setup, the state change that creates the condition, the action under test, and the assertions into visually distinct blocks.
- **Test Naming:** Describe the exact condition and expected behavior (e.g., `it('should reject stale lock ownership when process is dead')`).
- **Single Behavior:** Each test should establish one behavior under one relevant condition. Split independent behavior variants into separate tests, even when their setup is similar. Use parameterized tests when multiple values exercise the same behavior and assertion.
- **Isolation:** Tests must be deterministic, fast, and completely free of real network calls or unmocked disk I/O side effects.
