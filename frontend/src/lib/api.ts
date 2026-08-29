const BASE = import.meta.env.VITE_API_BASE_URL ?? '/api'

const ACCESS_KEY = 'pw.access'
const REFRESH_KEY = 'pw.refresh'

export const tokens = {
  get access() {
    return localStorage.getItem(ACCESS_KEY)
  },
  get refresh() {
    return localStorage.getItem(REFRESH_KEY)
  },
  set(access: string, refresh: string) {
    localStorage.setItem(ACCESS_KEY, access)
    localStorage.setItem(REFRESH_KEY, refresh)
  },
  clear() {
    localStorage.removeItem(ACCESS_KEY)
    localStorage.removeItem(REFRESH_KEY)
  },
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

async function readError(response: Response): Promise<string> {
  try {
    const body = await response.json()
    if (typeof body.detail === 'string') return body.detail
    // FastAPI validation errors arrive as a list of field problems.
    if (Array.isArray(body.detail)) {
      return body.detail
        .map((d: { loc?: string[]; msg: string }) => {
          const field = d.loc?.filter((p) => p !== 'body').join('.')
          return field ? `${field}: ${d.msg}` : d.msg
        })
        .join('; ')
    }
  } catch {
    // Fall through to the generic message below.
  }
  return `Request failed (${response.status})`
}

let refreshing: Promise<boolean> | null = null

async function tryRefresh(): Promise<boolean> {
  // Collapse concurrent 401s into a single refresh round trip.
  refreshing ??= (async () => {
    const token = tokens.refresh
    if (!token) return false
    try {
      const response = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: token }),
      })
      if (!response.ok) return false
      const data = await response.json()
      tokens.set(data.access_token, data.refresh_token)
      return true
    } catch {
      return false
    } finally {
      refreshing = null
    }
  })()
  return refreshing
}

interface RequestOptions {
  method?: string
  body?: unknown
  formData?: FormData
  retry?: boolean
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, formData, retry = true } = options

  const headers: Record<string, string> = {}
  const access = tokens.access
  if (access) headers.Authorization = `Bearer ${access}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: formData ?? (body !== undefined ? JSON.stringify(body) : undefined),
  })

  if (response.status === 401 && retry && tokens.refresh) {
    if (await tryRefresh()) {
      return request<T>(path, { ...options, retry: false })
    }
    tokens.clear()
  }

  if (!response.ok) {
    throw new ApiError(response.status, await readError(response))
  }

  if (response.status === 204) return undefined as T

  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) return response.json() as Promise<T>
  return response.text() as Promise<T>
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  upload: <T>(path: string, formData: FormData) => request<T>(path, { method: 'POST', formData }),
}

export async function login(email: string, password: string): Promise<void> {
  const form = new URLSearchParams({ username: email, password })
  const response = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
  })
  if (!response.ok) throw new ApiError(response.status, await readError(response))
  const data = await response.json()
  tokens.set(data.access_token, data.refresh_token)
}

/** Downloads a binary endpoint (PDF, CSV) with auth applied. */
export async function download(path: string, filename: string): Promise<void> {
  const headers: Record<string, string> = {}
  if (tokens.access) headers.Authorization = `Bearer ${tokens.access}`

  const response = await fetch(`${BASE}${path}`, { headers })
  if (!response.ok) throw new ApiError(response.status, await readError(response))

  const url = URL.createObjectURL(await response.blob())
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
