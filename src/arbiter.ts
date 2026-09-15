import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { childProcessInvocation, resolveExecutable } from './process.js';

/** The portable v1 protocol between a configured Arbiter process and Dispatcher. */
export type ArbiterRole = 'arbiter' | 'worker' | 'qa' | 'staff' | 'classifier';
export type ArbiterEvent = Readonly<{
  id: string;
  sessionId: string;
  issue: number;
  role: ArbiterRole;
  round: number;
  sha?: string;
  type: string;
  payload: Record<string, unknown>;
  emittedAt: string;
}>;

export type EngineeringSession = {
  sessionId: string;
  issue: number;
  status:
    | 'running'
    | 'waiting'
    | 'waiting_for_human_clarification'
    | 'worker_recovery_pending'
    | 'in_progress'
    | 'ready_for_human_merge'
    | 'blocked'
    | 'failed';
  round: number;
  review?: ReviewSnapshot;
  agents: Partial<Record<ArbiterRole, { runId: string; status: string; pid?: number }>>;
  processedEventIds: string[];
  unclassifiedFeedback: HumanFeedback[];
  feedback: HumanFeedback[];
  pendingClarifications: Array<{
    eventId: string;
    sessionId: string;
    question: string;
    target?: string;
    instructions?: string;
    createdAt: string;
  }>;
  answeredClarificationIds: string[];
  classifications: Classification[];
  updatedAt: string;
};

export type ReviewSnapshot = Readonly<{ sha: string; round: number; capturedAt: string }>;
export type HumanFeedback = Readonly<{
  sourceId: string;
  source: 'review' | 'inline_comment' | 'pr_comment' | 'issue_comment' | 'reply';
  body: string;
  target?: string;
  createdAt?: string;
}>;
export type HumanFeedbackBatch = Readonly<{
  items: readonly HumanFeedback[];
  formalApprovals: readonly string[];
  textualObjections: readonly string[];
}>;
export type Classification = Readonly<{
  sourceId: string;
  intent: 'approval' | 'concern' | 'requested_change' | 'blocking' | 'clarification';
  confidence: number;
  target?: string;
  rationale?: string;
}>;

export function formatClarificationComment(item: ArbiterEvent): string {
  const question = String(item.payload.question ?? 'Please provide clarification.');
  const target = typeof item.payload.target === 'string' ? item.payload.target : undefined;
  const instructions =
    typeof item.payload.instructions === 'string' ? item.payload.instructions : undefined;
  return `[Sloop Arbiter Clarification] session=${item.sessionId} event=${item.id}\n\n${question}${target ? `\n\nTarget: ${target}` : ''}${instructions ? `\n\n${instructions}` : ''}\n\nReply in normal language with the requested clarification.`;
}

export function createSession(issue: number, sessionId: string = randomUUID()): EngineeringSession {
  return {
    sessionId,
    issue,
    status: 'running',
    round: 1,
    agents: {},
    processedEventIds: [],
    unclassifiedFeedback: [],
    feedback: [],
    pendingClarifications: [],
    answeredClarificationIds: [],
    classifications: [],
    updatedAt: new Date().toISOString(),
  };
}

export function event(input: Omit<ArbiterEvent, 'id' | 'emittedAt'>): ArbiterEvent {
  return { ...input, id: randomUUID(), emittedAt: new Date().toISOString() };
}

/** Append-only JSONL storage. Invalid/truncated final lines are ignored for crash recovery. */
export class JsonlJournal {
  constructor(readonly file: string) {
    mkdirSync(dirname(file), { recursive: true });
  }
  append(value: ArbiterEvent): boolean {
    const ids = new Set(this.read().map((item) => item.id));
    if (ids.has(value.id)) return false;
    appendFileSync(this.file, JSON.stringify(value) + '\n', 'utf8');
    return true;
  }
  read(): ArbiterEvent[] {
    try {
      return readFileSync(this.file, 'utf8')
        .split(/\r?\n/)
        .filter(Boolean)
        .flatMap((line) => {
          try {
            const value = JSON.parse(line) as ArbiterEvent;
            return value && typeof value.id === 'string' ? [value] : [];
          } catch {
            return [];
          }
        });
    } catch {
      return [];
    }
  }
}

export function restoreSession(
  base: EngineeringSession,
  journal: JsonlJournal,
): EngineeringSession {
  const restored = {
    ...base,
    agents: { ...base.agents },
    processedEventIds: [...base.processedEventIds],
    pendingClarifications: [...(base.pendingClarifications ?? [])],
    answeredClarificationIds: [...(base.answeredClarificationIds ?? [])],
    classifications: [...(base.classifications ?? [])],
  };
  for (const item of journal.read()) {
    if (item.sessionId !== base.sessionId || restored.processedEventIds.includes(item.id)) continue;
    restored.processedEventIds.push(item.id);
    if (item.sha && (item.type === 'review_started' || item.type === 'worker_ready'))
      restored.review = { sha: item.sha, round: item.round, capturedAt: item.emittedAt };
    if (item.type === 'clarification_requested') {
      const pending = {
        eventId: item.id,
        sessionId: item.sessionId,
        question: String(item.payload.question ?? 'Please provide clarification.'),
        target: typeof item.payload.target === 'string' ? item.payload.target : undefined,
        instructions:
          typeof item.payload.instructions === 'string' ? item.payload.instructions : undefined,
        createdAt: item.emittedAt,
      };
      if (!restored.pendingClarifications.some((value) => value.eventId === item.id))
        restored.pendingClarifications.push(pending);
      restored.status = 'waiting_for_human_clarification';
    }
    if (item.type === 'clarification_answered') {
      const eventId = typeof item.payload.eventId === 'string' ? item.payload.eventId : undefined;
      if (eventId && !restored.answeredClarificationIds.includes(eventId)) {
        restored.answeredClarificationIds.push(eventId);
        restored.pendingClarifications = restored.pendingClarifications.filter(
          (value) => value.eventId !== eventId,
        );
      }
    }
    if (item.type === 'feedback_classified' && Array.isArray(item.payload.classifications)) {
      restored.classifications = item.payload.classifications.filter(
        (value): value is Classification => Boolean(value && typeof value === 'object'),
      );
    }
  }
  restored.updatedAt = new Date().toISOString();
  return restored;
}

export function isReviewCurrent(
  snapshot: ReviewSnapshot,
  sha: string,
  round = snapshot.round,
): boolean {
  return snapshot.sha === sha && snapshot.round === round;
}

export function classifyFeedback(items: readonly HumanFeedback[], raw: unknown): Classification[] {
  if (!Array.isArray(raw)) throw new Error('classifier output must be a JSON array');
  const known = new Set(items.map((item) => item.sourceId));
  return raw.flatMap((value) => {
    if (!value || typeof value !== 'object') return [];
    const item = value as Record<string, unknown>;
    if (typeof item.sourceId !== 'string' || !known.has(item.sourceId)) return [];
    if (
      !['approval', 'concern', 'requested_change', 'blocking', 'clarification'].includes(
        String(item.intent),
      )
    )
      return [];
    const confidence = Number(item.confidence);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) return [];
    return [
      {
        sourceId: item.sourceId,
        intent: item.intent as Classification['intent'],
        confidence,
        target: typeof item.target === 'string' ? item.target : undefined,
        rationale: typeof item.rationale === 'string' ? item.rationale : undefined,
      },
    ];
  });
}

/** Convert GitHub observations into stable source IDs without conflating approval and objections. */
export function collectHumanFeedback(input: {
  reviews?: readonly { id?: string; body?: string; state?: string; submittedAt?: string }[];
  comments?: readonly { id?: string; body?: string; createdAt?: string }[];
  processedIds?: readonly string[];
}): HumanFeedbackBatch {
  const processed = new Set(input.processedIds ?? []);
  const items: HumanFeedback[] = [];
  const formalApprovals: string[] = [];
  const textualObjections: string[] = [];
  for (const [index, review] of (input.reviews ?? []).entries()) {
    const sourceId = review.id ?? `review-${index}-${review.submittedAt ?? ''}`;
    if (processed.has(sourceId) || !review.body?.trim()) continue;
    const body = review.body.trim();
    if (review.state === 'APPROVED') formalApprovals.push(sourceId);
    if (/\b(?:but|however|concern|change|fix|objection|problem|block)/i.test(body))
      textualObjections.push(sourceId);
    items.push({ sourceId, source: 'review', body, createdAt: review.submittedAt });
  }
  for (const [index, comment] of (input.comments ?? []).entries()) {
    const sourceId = comment.id ?? `comment-${index}-${comment.createdAt ?? ''}`;
    if (processed.has(sourceId) || !comment.body?.trim()) continue;
    const body = comment.body.trim();
    if (/^\[(?:Sloop|Worker|QA\/SDET Review|Staff Review)/i.test(body)) continue;
    if (/\b(?:concern|change|fix|objection|problem|block)/i.test(body))
      textualObjections.push(sourceId);
    items.push({ sourceId, source: 'pr_comment', body, createdAt: comment.createdAt });
  }
  return { items, formalApprovals, textualObjections };
}

export type ProcessSpec = {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  role: ArbiterRole;
  issue: number;
  sessionId: string;
  round: number;
  logDirectory: string;
  env?: NodeJS.ProcessEnv;
  redactions?: readonly string[];
  input?: string;
  onStdoutLine?: (line: string) => void;
  onStderr?: (text: string) => void;
};
export async function runLoggedProcess(spec: ProcessSpec): Promise<{
  stdout: string;
  stderr: string;
  code: number | null;
  timedOut: boolean;
  logFile: string;
}> {
  mkdirSync(spec.logDirectory, { recursive: true });
  const logFile = join(
    spec.logDirectory,
    `${spec.sessionId}-${spec.role}-${spec.round}-${Date.now()}.jsonl`,
  );
  const redact = (text: string) =>
    spec.redactions?.reduce(
      (out, secret) => (secret ? out.split(secret).join('[REDACTED]') : out),
      text,
    ) ?? text;
  const write = (stream: 'stdout' | 'stderr', text: string) =>
    appendFileSync(
      logFile,
      JSON.stringify({
        sessionId: spec.sessionId,
        issue: spec.issue,
        role: spec.role,
        round: spec.round,
        stream,
        at: new Date().toISOString(),
        data: redact(text),
      }) + '\n',
    );
  const launch = childProcessInvocation(resolveExecutable(spec.command), spec.args);
  return await new Promise((resolve, reject) => {
    const child = spawn(launch.command, launch.args, {
      cwd: spec.cwd,
      windowsHide: true,
      env: spec.env ? { ...process.env, ...spec.env } : process.env,
      windowsVerbatimArguments: launch.windowsVerbatimArguments,
    });
    let stdout = '',
      stderr = '',
      pendingLine = '',
      timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, spec.timeoutMs);
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      write('stdout', text);
      if (spec.onStdoutLine) {
        pendingLine += text;
        const lines = pendingLine.split(/\r?\n/);
        pendingLine = lines.pop() ?? '';
        for (const line of lines) if (line.trim()) spec.onStdoutLine(line);
      }
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      write('stderr', text);
      spec.onStderr?.(text);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      write('stderr', `process_error=${error.message}`);
      reject(error);
    });
    if (spec.input) child.stdin.end(spec.input);
    else child.stdin.end();
    child.on('close', (code) => {
      clearTimeout(timer);
      if (pendingLine.trim()) spec.onStdoutLine?.(pendingLine);
      write('stderr', `process_exit code=${code ?? 'null'} timedOut=${timedOut}`);
      resolve({ stdout, stderr, code, timedOut, logFile });
    });
  });
}

export type EventConsumer = {
  journal: JsonlJournal;
  session: EngineeringSession;
  save: (session: EngineeringSession) => void;
  project?: (item: ArbiterEvent) => void;
};

/** Dispatcher-owned boundary: consume live Arbiter JSONL and make each event durable once. */
export function consumeArbiterLine(context: EventConsumer, line: string): boolean {
  let item: ArbiterEvent;
  try {
    item = JSON.parse(line) as ArbiterEvent;
  } catch {
    return false;
  }
  if (
    !item ||
    typeof item.id !== 'string' ||
    typeof item.sessionId !== 'string' ||
    typeof item.issue !== 'number' ||
    typeof item.role !== 'string' ||
    typeof item.type !== 'string' ||
    !item.payload ||
    typeof item.payload !== 'object'
  )
    return false;
  if (item.sessionId !== context.session.sessionId || item.issue !== context.session.issue)
    return false;
  if (!context.journal.append(item)) return false;
  const next = restoreSession(context.session, context.journal);
  context.session = next;
  context.save(next);
  context.project?.(item);
  return true;
}

export type FeedbackClassifier = (items: readonly HumanFeedback[]) => Promise<Classification[]>;

/** Classify one bounded batch; failures are intentionally non-blocking and preserve the batch. */
export async function classifyWithRetry(
  items: readonly HumanFeedback[],
  classifier: FeedbackClassifier,
  preserve: (items: readonly HumanFeedback[], error: unknown) => void,
): Promise<Classification[]> {
  if (!items.length) return [];
  try {
    return await classifier(items);
  } catch (error) {
    preserve(items, error);
    return [];
  }
}
