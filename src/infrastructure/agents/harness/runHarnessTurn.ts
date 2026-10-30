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
  if (!saved || !harness.capabilities.sessions)
    return startTurn(harness, store, key, context, initialPrompt);

  try {
    const result = await harness.resume(context, { prompt, session: saved });
    if (result.session && result.session !== saved) await store.set(key, result.session);
    return result;
  } catch (error) {
    if (!(error instanceof ResumeRejectedError)) throw error;
    warn(`saved harness session rejected; starting a fresh session (${saved})`);
    const fullPrompt = [
      context.issueContext,
      context.repository,
      context.progress,
      context.qaUpdates,
      prompt,
    ]
      .filter(Boolean)
      .join('\n\n');

    return startTurn(harness, store, key, context, fullPrompt);
  }
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
