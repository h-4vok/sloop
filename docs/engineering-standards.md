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

## 6. Naming Conventions & Domain Language
- **Domain Language:** Names must reflect the actual business domain of the project (e.g., `issue`, `pr`, `dispatch`, `worker`, `qa`). Avoid vague or generic names like `data`, `process`, `handle`, or `run`.
- **Booleans:** Must be prefixed with semantic action/state identifiers: `is`, `has`, `should`, `can` (e.g., `isValid`, `hasPermission`).
- **Functions & Methods:** Must follow an imperative `Verb + Noun` structure that clearly describes the action and target (e.g., `fetchIssueData`, `validateWorkflowState`).
- **Collections / Arrays:** Must be pluralized or explicitly suffixed (e.g., `activeSessions`, `errorList`).

## 7. Modern Unit Testing Standard
- **Test Runner (Vitest):** Use **Vitest** as the official test runner for its extreme speed, native TypeScript/ESM support, and instant feedback loop.
- **AAA Pattern (Arrange, Act, Assert):** Every test must explicitly separate its phases using blank lines:
  1. *Arrange:* Setup mocks, initial state, and injected dependencies.
  2. *Act:* Execute the function or method under test.
  3. *Assert:* Verify observable outcomes against expected results.
- **Test Naming:** Describe the exact condition and expected behavior (e.g., `it('should reject stale lock ownership when process is dead')`).
- **Isolation:** Tests must be deterministic, fast, and completely free of real network calls or unmocked disk I/O side effects.
