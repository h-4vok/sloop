import { selectIssues } from '../../../../dispatcher.js';
import type { ReadOnlyCommand } from '../../ReadOnlyCommand.js';
import { EXIT, type ExitCode } from '../../ExitCode.js';
import type { RuntimeIo } from '../../RuntimeIo.js';
import { repositoryPreflight } from '../RepositoryPreflight.js';
import { resultOutput } from '../ResultOutput.js';
import { readOnlyCommandSupport, type ReadOnlyContext } from './readOnlyCommandSupport.js';

/** Executes `sloop issues list`, preserving GitHub diagnostics and output modes. */
export const runIssueListCommand = Object.freeze({
  run(parsed: ReadOnlyCommand, io: RuntimeIo): ExitCode {
    const context = readOnlyCommandSupport.prepare(parsed, io);
    if (!context) return EXIT.preflight;
    const remote = io.run(
      'git',
      ['remote', 'get-url', context.config.repository.remote],
      context.root,
    );
    const repository = repositoryPreflight.githubRepository(
      repositoryPreflight.clean(remote.stdout),
    );
    if (!repository.ok) {
      const diagnostic = resultOutput.createDiagnostic(
        'repository-identity',
        'The configured remote is not a GitHub repository URL.',
        'Set the configured remote to the target GitHub repository URL.',
      );
      return readOnlyCommandSupport.emitPreflightFailure(parsed, [diagnostic], io);
    }
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
        repository.value,
        '--json',
        'number,title,url,labels',
      ],
      context.root,
    );
    return response.status === 0
      ? this.emitIssueListResult(parsed, context, response.stdout, io)
      : this.emitIssueListFailure(parsed, io);
  },

  emitIssueListResult(
    parsed: ReadOnlyCommand,
    context: ReadOnlyContext,
    response: string,
    io: RuntimeIo,
  ): ExitCode {
    try {
      const issues = this.parseAndSelectIssues(response, context);
      const envelope = resultOutput.createEnvelope(
        parsed.command,
        issues.length ? 'completed' : 'idle',
        'result',
        issues.length ? `${issues.length} eligible issue(s).` : 'No eligible issues.',
        { repository: context.root, configRef: context.ref, issues },
        [],
        issues.map(({ number }) => number),
      );
      const humanIssues = issues.map((issue) => `#${issue.number} ${issue.title}`).join('\n');
      if (!parsed.json && humanIssues) io.stdout(`${envelope.summary}\n${humanIssues}`);
      else resultOutput.emit(envelope, parsed.json, EXIT.ok, io);
      return EXIT.ok;
    } catch {
      return this.emitInvalidIssueList(parsed, io);
    }
  },

  parseAndSelectIssues(response: string, context: ReadOnlyContext) {
    const rawIssues = JSON.parse(response) as {
      number: number;
      title: string;
      labels?: { name: string }[];
    }[];
    const issues = rawIssues.map((issue) => ({
      ...issue,
      labels: issue.labels?.map(({ name }) => name),
    }));
    return selectIssues(issues, context.config.github.labels.priority);
  },

  emitIssueListFailure(parsed: ReadOnlyCommand, io: RuntimeIo): ExitCode {
    const diagnostic = resultOutput.createDiagnostic(
      'github',
      'GitHub did not return issues.',
      'Check network access and retry.',
    );
    const envelope = resultOutput.createEnvelope(
      parsed.command,
      'failed',
      'result',
      'GitHub issue listing failed.',
      null,
      [diagnostic],
    );
    return resultOutput.emit(envelope, parsed.json, EXIT.external, io);
  },

  emitInvalidIssueList(parsed: ReadOnlyCommand, io: RuntimeIo): ExitCode {
    const diagnostic = resultOutput.createDiagnostic(
      'github',
      'Issue JSON could not be parsed.',
      'Retry the command.',
    );
    const envelope = resultOutput.createEnvelope(
      parsed.command,
      'failed',
      'result',
      'GitHub returned invalid issue data.',
      null,
      [diagnostic],
    );
    return resultOutput.emit(envelope, parsed.json, EXIT.external, io);
  },
});
