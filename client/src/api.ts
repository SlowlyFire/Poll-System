// Every call to the server goes through this file. Nothing else in the app calls fetch.
//
// Why centralise it: fetch has two traps. It does NOT throw on a 404 or a 500 — it
// resolves happily with res.ok === false — and the error message the server sends lives
// in the response body, which you have to parse yourself. Scattering that boilerplate
// across components means one of them eventually forgets a check and renders undefined.
// One wrapper handles it once, and every component just gets data or an exception.

import type { PollDetail, PollSummary } from './types';

/**
 * Wraps fetch: throws a useful Error on any non-2xx response, otherwise returns the
 * parsed JSON body typed as T.
 */
async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });

  if (!res.ok) {
    // Our API always sends errors as { error: string }. If something upstream returns
    // HTML instead (a proxy, a crash), parsing fails — hence the fallback message.
    const body = await res.json().catch(() => null);
    const message = body?.error ?? `Request failed (${res.status})`;
    // Attach the status so callers can react to a specific one, e.g. 409 for a
    // duplicate vote, without string-matching the message.
    throw Object.assign(new Error(message), { status: res.status });
  }

  return res.json() as Promise<T>;
}

// Note the relative URLs. No hostname, no port: in development the Vite proxy forwards
// /api to :3001, and in production Express serves the API and this page from the same
// origin. The same code works in both, which is why there is no API_BASE_URL setting.

export function listPolls(): Promise<PollSummary[]> {
  return request<PollSummary[]>('/api/polls');
}

export function getPoll(id: string, username: string): Promise<PollDetail> {
  // encodeURIComponent so a username with a space or an & cannot break the query string.
  const query = username ? `?username=${encodeURIComponent(username)}` : '';
  return request<PollDetail>(`/api/polls/${id}${query}`);
}

export function createPoll(input: {
  question: string;
  createdBy: string;
  options: string[];
}): Promise<{ id: string }> {
  return request<{ id: string }>('/api/polls', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function castVote(pollId: string, username: string, optionId: number): Promise<{ ok: true }> {
  return request<{ ok: true }>(`/api/polls/${pollId}/vote`, {
    method: 'POST',
    body: JSON.stringify({ username, optionId }),
  });
}
