/** Identity of the process holding a dispatcher lock. */
export type LockOwner = Readonly<{ pid: number; createdAt: number; token: string }>;
