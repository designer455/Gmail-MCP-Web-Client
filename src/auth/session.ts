import { AsyncLocalStorage } from 'async_hooks';
import { UnauthorizedError } from '../utils/errors.js';

export interface UserContext {
  userId: string;
  email?: string;
  isAuthenticated: boolean;
  metadata?: Record<string, unknown>;
}

// AsyncLocalStorage provides request-scoped context isolation across asynchronous call chains
const userContextStorage = new AsyncLocalStorage<UserContext>();

/**
 * Returns the currently active authenticated user context.
 * Throws UnauthorizedError if no authenticated user context exists.
 */
export function getCurrentUser(): UserContext {
  const context = userContextStorage.getStore();
  if (!context || !context.userId) {
    throw new UnauthorizedError('No active user session found. Operation requires authentication.');
  }
  return context;
}

/**
 * Returns the currently active user context if available, or null.
 * Does not throw.
 */
export function getOptionalCurrentUser(): UserContext | null {
  return userContextStorage.getStore() || null;
}

/**
 * Executes a function within the isolated context of a specific user.
 */
export function runWithUserContext<T>(
  context: UserContext,
  fn: () => T | Promise<T>
): Promise<T> | T {
  return userContextStorage.run(context, fn);
}

/**
 * Helper to create a user context
 */
export function createUserContext(
  userId: string,
  email?: string,
  metadata?: Record<string, unknown>
): UserContext {
  const isAnonymous = !userId || userId === 'anonymous';
  return {
    userId: isAnonymous ? 'anonymous' : userId,
    email,
    isAuthenticated: !isAnonymous,
    metadata,
  };
}
