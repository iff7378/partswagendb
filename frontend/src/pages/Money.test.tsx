import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import Money from './Money'
import type { SettleUpReport } from '../lib/types'

vi.mock('../lib/auth', () => ({ useAuth: () => ({ canEdit: true }) }))

const REPORT: SettleUpReport = {
  period_start: '2026-07-01',
  period_end: '2026-09-30',
  total_revenue: '1500.00',
  total_expenses: '2000.00',
  profit: '-500.00',
  balances: [
    {
      user: { id: 1, full_name: 'Ian', email: 'ian@example.com' },
      share_bps: 5000,
      expenses_paid: '2000.00',
      revenue_collected: '0.00',
      settlements_paid: '0.00',
      settlements_received: '0.00',
      net_holding: '-2000.00',
      entitled: '-250.00',
      delta: '-1750.00',
    },
    {
      user: { id: 2, full_name: 'Partner', email: 'partner@example.com' },
      share_bps: 5000,
      expenses_paid: '0.00',
      revenue_collected: '1500.00',
      settlements_paid: '0.00',
      settlements_received: '0.00',
      net_holding: '1500.00',
      entitled: '-250.00',
      delta: '1750.00',
    },
  ],
  transfers: [
    {
      from_user: { id: 2, full_name: 'Partner', email: 'partner@example.com' },
      to_user: { id: 1, full_name: 'Ian', email: 'ian@example.com' },
      amount: '1750.00',
    },
  ],
  unallocated_share_bps: 0,
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Money />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const body = url.includes('/settle-up') ? REPORT : []
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Money page', () => {
  it('shows the period totals', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('Money in')).toBeInTheDocument())

    // The amount also appears in the balances table, so scope to the stat tile.
    const revenueTile = screen.getByText('Money in').parentElement
    expect(revenueTile).toHaveTextContent('$1,500.00')

    expect(screen.getByText('Money out').parentElement).toHaveTextContent('$2,000.00')
    expect(screen.getByText('Loss').parentElement).toHaveTextContent('-$500.00')
  })

  it('spells out who pays whom', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText(/pays/)).toBeInTheDocument())

    const transfer = screen.getByText(/pays/).closest('p')
    expect(transfer).toHaveTextContent('Partner pays Ian $1,750.00')
  })

  it('surfaces a share misconfiguration', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const body = url.includes('/settle-up')
          ? { ...REPORT, unallocated_share_bps: 2000 }
          : []
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }),
    )

    renderPage()
    await waitFor(() =>
      expect(screen.getByText(/add up to 80%, not 100%/)).toBeInTheDocument(),
    )
  })
})
