/** Carries a successful value or a structured failure without throwing. */
export type Result<T, E> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: E }>;

export const result = Object.freeze({
  success<T>(value: T): Result<T, never> {
    return { ok: true, value };
  },

  failure<E>(error: E): Result<never, E> {
    return { ok: false, error };
  },
});
