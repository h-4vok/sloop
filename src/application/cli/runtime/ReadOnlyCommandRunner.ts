import { join } from 'node:path';
import { selectIssues } from '../../../dispatcher.js';
import type { SloopConfig } from '../../../config.js';
import { createProductionRuntimeIo } from '../../../infrastructure/host/createProductionRuntimeIo.js';
import type { ReadOnlyCommand } from '../ReadOnlyCommand.js';
import { EXIT, type ExitCode } from '../ExitCode.js';
import type { RuntimeIo } from '../RuntimeIo.js';
import type { Diagnostic, ResultEnvelope, ResultStatus } from '../RuntimeResult.js';
import { recoveryDiagnostics } from './RecoveryDiagnostics.js';
import { repositoryPreflight } from './RepositoryPreflight.js';
import { resultOutput } from './ResultOutput.js';

type ReadOnlyContext = Readonly<{ root: string; config: SloopConfig; ref: string }>;

type WorkflowState = Readonly<{
  workflow: Record<string, unknown>;
  failure?: Diagnostic;
}>;

/** Executes read-only status, issue-list, and doctor commands. */
export const readOnlyCommandRunner = Object.freeze({
  run(parsed: ReadOnlyCommand, providedIo?: RuntimeIo): ExitCode {
    const io = providedIo ?? createProductionRuntimeIo();
    const context = this.loadContext(parsed, io);
    if (!context) return EXIT.preflight;

    const failures = this.checkPrerequisites(parsed, context, io);
    if (failures.length) return this.emitPreflightFailure(parsed, failures, io);
    if (parsed.command === 'issues list') return this.listEligibleIssues(parsed, context, io);

    return this.reportWorkflowStatus(parsed, context, io);
  },

  loadContext(parsed: ReadOnlyCommand, io: RuntimeIo): ReadOnlyContext | undefined {
    const repositoryResult = repositoryPreflight.discoverRepository(io);
    if (!repositoryResult.ok) {
      const result = resultOutput.createEnvelope(
        parsed.command,
        'failed',
        'discovery',
        'Repository startup failed.',
        null,
        [repositoryResult.error],
      );
      resultOutput.emit(result, parsed.json, EXIT.preflight, io);

      return undefined;
    }
    const configResult = repositoryPreflight.loadBaseConfig(repositoryResult.value, io);
    if (!configResult.ok) {
      const result = resultOutput.createEnvelope(
        parsed.command,
        'failed',
        'discovery',
        'Repository startup failed.',
        null,
        [configResult.error],
      );
      resultOutput.emit(result, parsed.json, EXIT.preflight, io);
      return undefined;
    }
    return {
      root: repositoryResult.value,

      config: configResult.value.config,

      ref: configResult.value.ref,
    };
  },

  checkPrerequisites(
    parsed: ReadOnlyCommand,
    context: ReadOnlyContext,
    io: RuntimeIo,
  ): Diagnostic[] {
    if (parsed.command === 'doctor')
      return repositoryPreflight.doctorChecks(context.root, context.config, io);

    const commonFailures = repositoryPreflight.commonChecks(context.root, context.config, io);
    if (parsed.command !== 'issues list') return commonFailures;

    return [
      ...commonFailures,
      ...repositoryPreflight.githubChecks(context.root, context.config, io),
    ];
  },

  emitPreflightFailure(
    parsed: ReadOnlyCommand,
    failures: readonly Diagnostic[],
    io: RuntimeIo,
  ): ExitCode {
    const result = resultOutput.createEnvelope(
      parsed.command,
      'failed',
      'preflight',
      'Preflight validation failed.',
      null,
      failures,
    );

    return resultOutput.emit(result, parsed.json, EXIT.preflight, io);
  },

  listEligibleIssues(parsed: ReadOnlyCommand, context: ReadOnlyContext, io: RuntimeIo): ExitCode {
    const remoteUrl = this.readRemoteUrl(context, io);
    const repositoryResult = repositoryPreflight.githubRepository(remoteUrl);
    if (!repositoryResult.ok) {
      const failure = resultOutput.createDiagnostic(
        'repository-identity',
        'The configured remote is not a GitHub repository URL.',
        'Set the configured remote to the target GitHub repository URL.',
      );
      return this.emitPreflightFailure(parsed, [failure], io);
    }
    const repository = repositoryResult.value;
    const response = io.run(
      'gh',
      [
        'issue',
        'list',
        '--state',
        'open',
        '--label',
        context.config.github.labels.eligible,
        '--repo',
        repository,
        '--json',
        'number,title,url,labels',
      ],
      context.root,
    );
    if (response.status !== 0) return this.emitIssueListFailure(parsed, io);

    return this.emitIssueListResult(parsed, context, response.stdout, io);
  },

  readRemoteUrl(context: ReadOnlyContext, io: RuntimeIo): string {
    const response = io.run(
      'git',
      ['remote', 'get-url', context.config.repository.remote],
      context.root,
    );

    return repositoryPreflight.clean(response.stdout);
  },

  emitIssueListFailure(parsed: ReadOnlyCommand, io: RuntimeIo): ExitCode {
    const failure = resultOutput.createDiagnostic(
      'github',
      'GitHub did not return issues.',
      'Check network access and retry.',
    );
    const result = resultOutput.createEnvelope(
      parsed.command,
      'failed',
      'result',
      'GitHub issue listing failed.',
      null,
      [failure],
    );

    return resultOutput.emit(result, parsed.json, EXIT.external, io);
  },

  emitIssueListResult(
    parsed: ReadOnlyCommand,
    context: ReadOnlyContext,
    response: string,
    io: RuntimeIo,
  ): ExitCode {
    try {
      const issues = this.parseAndSelectIssues(response, context.config);
      const result = resultOutput.createEnvelope(
        parsed.command,
        issues.length ? 'completed' : 'idle',
        'result',
        issues.length ? `${issues.length} eligible issue(s).` : 'No eligible issues.',
        { repository: context.root, configRef: context.ref, issues },
        [],
        issues.map(({ number }) => number),
      );
      const humanIssues = issues.map((issue) => `#${issue.number} ${issue.title}`).join('\n');
      if (!parsed.json && humanIssues) io.stdout(`${result.summary}\n${humanIssues}`);
      else resultOutput.emit(result, parsed.json, EXIT.ok, io);

      return EXIT.ok;
    } catch {
      return this.emitInvalidIssueList(parsed, io);
    }
  },

  parseAndSelectIssues(response: string, config: SloopConfig) {
    const rawIssues = JSON.parse(response) as {
      number: number;
      title: string;
      labels?: { name: string }[];
    }[];
    const issues = rawIssues.map((issue) => ({
      ...issue,

      labels: issue.labels?.map(({ name }) => name),
    }));

    return selectIssues(issues, config.github.labels.priority);
  },

  emitInvalidIssueList(parsed: ReadOnlyCommand, io: RuntimeIo): ExitCode {
    const failure = resultOutput.createDiagnostic(
      'github',
      'Issue JSON could not be parsed.',
      'Retry the command.',
    );
    const result = resultOutput.createEnvelope(
      parsed.command,
      'failed',
      'result',
      'GitHub returned invalid issue data.',
      null,
      [failure],
    );

    return resultOutput.emit(result, parsed.json, EXIT.external, io);
  },

  reportWorkflowStatus(parsed: ReadOnlyCommand, context: ReadOnlyContext, io: RuntimeIo): ExitCode {
    const state = this.loadWorkflowState(parsed, context.root, io);
    if (state.failure) return this.emitUnreadableWorkflowState(parsed, state.failure, io);

    const result = this.createWorkflowResult(parsed, context, state.workflow);
    const status = result.status;

    return resultOutput.emit(
      result,
      parsed.json,
      status === 'blocked' ? EXIT.blocked : EXIT.ok,
      io,
    );
  },

  loadWorkflowState(parsed: ReadOnlyCommand, root: string, io: RuntimeIo): WorkflowState {
    const workflowFile = join(root, '.sloop', 'state.json');
    if (parsed.command !== 'status' || !io.canRead(workflowFile)) return { workflow: {} };

    try {
      const parsedState: unknown = JSON.parse(io.readFile(workflowFile));
      if (!parsedState || typeof parsedState !== 'object' || Array.isArray(parsedState))
        throw new Error('state must be a JSON object');

      return { workflow: parsedState as Record<string, unknown> };
    } catch {
      return {
        workflow: {},

        failure: resultOutput.createDiagnostic(
          'state',
          'The local workflow state is invalid JSON.',
          'No safe repair command is available because the state file could not be inspected.',
        ),
      };
    }
  },

  emitUnreadableWorkflowState(
    parsed: ReadOnlyCommand,
    failure: Diagnostic,
    io: RuntimeIo,
  ): ExitCode {
    const result = resultOutput.createEnvelope(
      parsed.command,
      'blocked',
      'result',
      'Workflow state is unreadable.',
      null,
      [failure],
    );

    return resultOutput.emit(result, parsed.json, EXIT.blocked, io);
  },

  createWorkflowResult(
    parsed: ReadOnlyCommand,
    context: ReadOnlyContext,
    workflow: Record<string, unknown>,
  ): ResultEnvelope {
    const workflowStatus = String(workflow.status ?? 'idle');
    const status = this.workflowResultStatus(workflowStatus);
    const issue = typeof workflow.issue === 'number' ? workflow.issue : undefined;
    const pullRequest = typeof workflow.pr === 'number' ? workflow.pr : undefined;
    const recovery = this.recoveryAction(workflowStatus, issue, pullRequest);
    const summary = this.workflowSummary(parsed.command, workflowStatus, context.root);
    const displayedWorkflow = this.workflowDetails(parsed.verbose, workflow);
    const result = {
      repository: context.root,

      configRef: context.ref,

      workflow: displayedWorkflow,

      ...(parsed.verbose ? { config: context.config } : {}),

      ...(recovery ? { nextAction: recovery } : {}),
    };
    const diagnostics = recoveryDiagnostics.toDiagnostics(workflow);

    return resultOutput.createEnvelope(
      parsed.command,
      parsed.command === 'status' ? status : 'completed',
      'result',
      summary,
      result,
      diagnostics,
      typeof workflow.issue === 'number' ? [workflow.issue] : [],
      typeof workflow.pr === 'number' ? [workflow.pr] : [],
    );
  },

  workflowResultStatus(workflowStatus: string): ResultStatus {
    if (workflowStatus === 'blocked') return 'blocked';
    if (/running|pending|review|claimed/.test(workflowStatus)) return 'waiting';

    return 'idle';
  },

  recoveryAction(
    workflowStatus: string,
    issue: number | undefined,
    pullRequest: number | undefined,
  ) {
    if (['worker_recovery_pending', 'ci_failed', 'qa_changes_requested'].includes(workflowStatus)) {
      return {
        ...(issue && pullRequest
          ? { command: `sloop --prepare-recovery ${issue} --pr ${pullRequest}` }
          : { command: 'sloop status --verbose' }),

        description:
          issue && pullRequest
            ? 'Prepare local recovery for the recorded issue and PR.'
            : 'Inspect the recovery state; issue or PR context is unavailable.',

        mutates: Boolean(issue && pullRequest),
      };
    }
    if (workflowStatus === 'blocked' || workflowStatus === 'abandoned') {
      return {
        command: 'sloop status --verbose',

        description: 'Inspect the recorded blocker and available context.',

        mutates: false,
      };
    }

    return undefined;
  },

  workflowSummary(
    command: ReadOnlyCommand['command'],
    workflowStatus: string,
    root: string,
  ): string {
    if (command !== 'status') return 'All checks passed.';
    if (workflowStatus === 'idle') return `Repository ${root} is idle.`;

    return `Repository ${root} workflow status is ${workflowStatus}.`;
  },

  workflowDetails(verbose: boolean, workflow: Record<string, unknown>) {
    if (verbose) return workflow;

    return {
      issue: workflow.issue,

      pr: workflow.pr,

      status: workflow.status,

      lastError: workflow.lastError,
    };
  },
});
