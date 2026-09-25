import { config } from '../config/env';
import { auth } from '../lib/firebase';
import type { AccessInfo, ApiErrorBody } from '../types/api';

const REQUEST_TIMEOUT_MS = 15_000;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  get isSubscriptionRequired(): boolean {
    return this.status === 403 && this.code === 'SUBSCRIPTION_REQUIRED';
  }
}

// -----------------------------------------------------------------------------
// Paywall event bus: any 403 SUBSCRIPTION_REQUIRED, from any endpoint, opens
// the paywall instantly (PaywallProvider subscribes to this).
// -----------------------------------------------------------------------------

export interface PaywallTrigger {
  message: string;
  access: AccessInfo | null;
}

type PaywallListener = (trigger: PaywallTrigger) => void;
const paywallListeners = new Set<PaywallListener>();

export function onSubscriptionRequired(listener: PaywallListener): () => void {
  paywallListeners.add(listener);
  return () => {
    paywallListeners.delete(listener);
  };
}

function isAccessInfo(value: unknown): value is AccessInfo {
  return (
    typeof value === 'object' &&
    value !== null &&
    'freeReelLimit' in value &&
    'freeReelsWatched' in value &&
    'subscribed' in value
  );
}

function emitSubscriptionRequired(error: ApiError): void {
  const trigger: PaywallTrigger = {
    message: error.message,
    access: isAccessInfo(error.details) ? error.details : null,
  };
  paywallListeners.forEach((listener) => {
    try {
      listener(trigger);
    } catch (listenerError) {
      console.warn('Paywall listener failed', listenerError);
    }
  });
}

// -----------------------------------------------------------------------------
// Request helper
// -----------------------------------------------------------------------------

type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, QueryValue>;
  /** Attach the Firebase ID token (default true). */
  authenticated?: boolean;
  signal?: AbortSignal;
}

function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const url = `${config.apiUrl}${path}`;
  if (!query) return url;
  const params = Object.entries(query)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  return params.length > 0 ? `${url}?${params.join('&')}` : url;
}

async function getIdToken(forceRefresh: boolean): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new ApiError(401, 'UNAUTHENTICATED', 'Please sign in to continue');
  try {
    return await user.getIdToken(forceRefresh);
  } catch {
    throw new ApiError(401, 'UNAUTHENTICATED', 'Your session has expired. Please sign in again.');
  }
}

async function send(path: string, options: RequestOptions, token: string | null): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const abortFromCaller = () => controller.abort();
  options.signal?.addEventListener('abort', abortFromCaller);

  try {
    return await fetch(buildUrl(path, options.query), {
      method: options.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
  } catch (error) {
    if (options.signal?.aborted) throw new ApiError(0, 'ABORTED', 'Request cancelled');
    if (controller.signal.aborted) throw new ApiError(0, 'TIMEOUT', 'The server took too long to respond');
    throw new ApiError(0, 'NETWORK_ERROR', 'No internet connection. Check your network and try again.', error);
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abortFromCaller);
  }
}

/**
 * Typed JSON request against the EduShorts API. Retries once with a
 * force-refreshed ID token on 401, and broadcasts SUBSCRIPTION_REQUIRED.
 */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const authenticated = options.authenticated ?? true;

  let token = authenticated ? await getIdToken(false) : null;
  let response = await send(path, options, token);

  if (response.status === 401 && authenticated) {
    token = await getIdToken(true);
    response = await send(path, options, token);
  }

  let payload: unknown = null;
  const text = await response.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const body = (payload ?? {}) as ApiErrorBody;
    const error = new ApiError(
      response.status,
      body.error?.code ?? `HTTP_${response.status}`,
      body.error?.message ?? `Request failed with status ${response.status}`,
      body.error?.details,
    );
    if (error.isSubscriptionRequired) emitSubscriptionRequired(error);
    throw error;
  }

  return payload as T;
}

export function describeError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong';
}
