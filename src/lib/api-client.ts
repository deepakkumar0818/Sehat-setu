// Browser client for the /api/v1 endpoints. Errors are thrown, never replaced
// with mock or cached data — the calling hook shows its error state.

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  /** Structured context the server attached (e.g. a conflicting record). */
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** Query string from defined, non-empty values ("all" is passed through; the server understands it). */
export function toQuery(params: object = {}): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    qs.set(key, String(value));
  }
  const s = qs.toString();
  return s ? `?${s}` : "";
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiRequestError(0, "NETWORK", "Couldn't reach the server. Check your connection and try again.");
  }
  const json = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string; details?: unknown } } | null;
  if (!res.ok) {
    // 401s (expired session) are turned into a sign-in redirect by the query client in app/providers.tsx.
    throw new ApiRequestError(res.status, json?.error?.code ?? `HTTP_${res.status}`, json?.error?.message ?? "The request failed. Please try again.", json?.error?.details);
  }
  return json as T;
}

export const apiGet = <T>(path: string, params?: object) => request<T>("GET", `${path}${toQuery(params)}`);
export const apiPost = <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {});
export const apiPatch = <T>(path: string, body: unknown) => request<T>("PATCH", path, body);
export const apiPut = <T>(path: string, body: unknown) => request<T>("PUT", path, body);
export const apiDelete = <T>(path: string) => request<T>("DELETE", path);
