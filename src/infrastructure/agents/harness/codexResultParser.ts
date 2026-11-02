import type { HarnessResult } from './HarnessContext.js';
import { ResumeAmbiguousError } from './ResumeAmbiguousError.js';
import { ResumeRejectedError } from './ResumeRejectedError.js';

/** Parses Codex JSON events into the session and output expected by the harness. */
export function readCodexResult(
  stdout: string,
  issue: number,
  code: number | null,
  started: boolean,
  stderr: string,
): HarnessResult {
  let session: string | undefined;
  const messages: string[] = [];
  collectCodexEvents(stdout, (id) => (session = id), messages);
  if (code !== 0) throw createCodexProcessError(started, stderr);
  if (!session) throw new Error(`Codex completed without a valid session ID for issue #${issue}`);
  return createSuccessfulHarnessResult(session, messages);
}

function collectCodexEvents(
  stdout: string,
  setSession: (session: string) => void,
  messages: string[],
): void {
  for (const line of stdout.split(/\r?\n/)) readCodexEvent(line, setSession, messages);
}

function createCodexProcessError(started: boolean, stderr: string): Error {
  if (started) return new ResumeAmbiguousError(stderr || 'Codex failed after starting the turn');
  return new ResumeRejectedError(stderr || 'Codex rejected the session');
}

function createSuccessfulHarnessResult(
  session: string,
  messages: readonly string[],
): HarnessResult {
  return { accepted: true, session, ...(messages.length ? { output: messages.join('\n') } : {}) };
}

function readCodexEvent(
  line: string,
  setSession: (session: string) => void,
  messages: string[],
): void {
  try {
    const value = JSON.parse(line) as Record<string, unknown>;
    readCodexSession(value, setSession);
    appendCodexMessage(value, messages);
  } catch {
    // Codex may emit non-JSON diagnostic lines alongside protocol events.
  }
}

function readCodexSession(
  value: Record<string, unknown>,
  setSession: (session: string) => void,
): void {
  if (value.type === 'thread.started' && typeof value.thread_id === 'string') {
    setSession(value.thread_id);
    return;
  }
  if (typeof value.session_id === 'string') setSession(value.session_id);
}

function appendCodexMessage(value: Record<string, unknown>, messages: string[]): void {
  const message = completedAgentMessage(value);
  if (message !== undefined) messages.push(message);
}

function completedAgentMessage(value: Record<string, unknown>): string | undefined {
  if (value.type !== 'item.completed' || !isRecord(value.item)) return undefined;
  if (value.item.type !== 'agent_message' || typeof value.item.text !== 'string') return undefined;
  return value.item.text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
