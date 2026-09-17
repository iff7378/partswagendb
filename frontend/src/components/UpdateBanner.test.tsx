import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api', () => ({ api: { get: vi.fn() } }))

/** Loaded fresh each time, because the built version is read at module load. */
async function renderAt(built: string | undefined, serving: string) {
  vi.resetModules()
  if (built === undefined) vi.stubEnv('VITE_APP_VERSION', '')
  else vi.stubEnv('VITE_APP_VERSION', built)

  const { api } = await import('../lib/api')
  vi.mocked(api.get).mockResolvedValue({ status: 'ok', version: serving })

  const UpdateBanner = (await import('./UpdateBanner')).default
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <UpdateBanner />
    </QueryClientProvider>,
  )
}

afterEach(() => vi.unstubAllEnvs())

describe('UpdateBanner', () => {
  it('speaks up when the page is older than what the server serves', async () => {
    await renderAt('2026.09.16', '2026.09.17')
    expect(await screen.findByText(/running an older version/i)).toBeInTheDocument()
    expect(screen.getByText(/2026\.09\.17 is available/)).toBeInTheDocument()
  })

  it('stays quiet when the page is current', async () => {
    await renderAt('2026.09.17', '2026.09.17')
    await waitFor(() => expect(screen.queryByText(/older version/i)).toBeNull())
  })

  it('stays quiet in development, where the versions never match', async () => {
    await renderAt(undefined, 'dev')
    await waitFor(() => expect(screen.queryByText(/older version/i)).toBeNull())
  })
})
