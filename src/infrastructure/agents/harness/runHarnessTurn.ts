import type { Harness, HarnessContext, HarnessResult, SessionKey } from './HarnessContext.js';
import { ResumeRejectedError } from './ResumeRejectedError.js';
import type { SessionStore } from './SessionStore.js';

/** Resumes saved work and safely starts fresh only after a pre-turn rejection. */
export async function runHarnessTurn(
  harness: Harness,
  store: SessionStore,
  key: SessionKey,
  context: HarnessContext,
  prompt: string,
  warn: (message: string) => void = console.warn,
  initialPrompt = prompt,
): Promise<HarnessResult> {
  const saved = harness.capabilities.sessions ? await store.get(key) : undefined;
  if (!shouldResumeSession(saved, harness))
    return startTurn(harness, store, key, context, initialPrompt);

  return resumeSavedSession(harness, store, key, context, prompt, saved, warn);
}

function shouldResumeSession(saved: string | undefined, harness: Harness): saved is string {
  return Boolean(saved && harness.capabilities.sessions);
}

async function resumeSavedSession(
  harness: Harness,
  store: SessionStore,
  key: SessionKey,
  context: HarnessContext,
  prompt: string,
  saved: string,
  warn: (message: string) => void,
): Promise<HarnessResult> {
  try {
    const result = await harness.resume(context, { prompt, session: saved });
    if (result.session && result.session !== saved) await store.set(key, result.session);
    return result;
  } catch (error) {
    return restartAfterRejectedSession(error, harness, store, key, context, prompt, saved, warn);
  }
}

async function restartAfterRejectedSession(
  error: unknown,
  harness: Harness,
  store: SessionStore,
  key: SessionKey,
  context: HarnessContext,
  prompt: string,
  saved: string,
  warn: (message: string) => void,
): Promise<HarnessResult> {
  if (!(error instanceof ResumeRejectedError)) throw error;
  warn(`saved harness session rejected; starting a fresh session (${saved})`);
  return startTurn(harness, store, key, context, rebuildPrompt(context, prompt));
}

function rebuildPrompt(context: HarnessContext, prompt: string): string {
  return [context.issueContext, context.repository, context.progress, context.qaUpdates, prompt]
    .filter(Boolean)
    .join('\n\n');
}

async function startTurn(
  harness: Harness,
  store: SessionStore,
  key: SessionKey,
  context: HarnessContext,
  prompt: string,
): Promise<HarnessResult> {
  const result = await harness.start(context, { prompt });
  if (result.session && harness.capabilities.sessions) await store.set(key, result.session);

  return result;
}
