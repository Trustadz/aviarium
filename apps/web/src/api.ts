export interface Account { id: string; name: string; role: 'user' | 'admin'; editorGames: string[] }
export interface SessionAccount extends Account { expiresAt: string }
export class ApiError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}
export async function api<T>(url: string, init?: RequestInit, account?: string): Promise<T> {
  const headers = new Headers(init?.headers)
  if (init?.body) headers.set('Content-Type', 'application/json')
  if (account) headers.set('X-Aviarium-Account', account)
  const response = await fetch('/api' + url, { ...init, headers, cache: 'no-store' })
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new ApiError(response.status, data.error ?? 'The server could not process this request.')
  }
  return response.status === 204 ? undefined as T : response.json()
}
export const json = (method: string, data: unknown): RequestInit => ({ method, body: JSON.stringify(data) })
export const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong.'
