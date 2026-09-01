import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'

import { ErrorNote, Spinner } from './ui'
import { api } from '../lib/api'
import { VEHICLE_STATUS_LABELS, money, signedMoney } from '../lib/format'
import type { VehicleResults as Results } from '../lib/types'

/** How each donor car has done: what it cost, what it returned, where it stands. */
export default function VehicleResults() {
  const results = useQuery({
    queryKey: ['by-vehicle'],
    queryFn: () => api.get<Results>('/reports/by-vehicle'),
  })

  const rows = results.data?.vehicles ?? []
  const totals = rows.reduce(
    (sum, row) => ({
      spent: sum.spent + Number(row.total_expenses),
      earned: sum.earned + Number(row.total_revenue),
      profit: sum.profit + Number(row.profit),
    }),
    { spent: 0, earned: 0, profit: 0 },
  )

  return (
    <section className="mt-8">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-soft">
        How each car has done
      </h2>

      <ErrorNote error={results.error} />
      {results.isLoading && <Spinner />}

      {results.data && rows.length === 0 && (
        <p className="card px-4 py-8 text-center text-sm text-ink-soft">No cars yet.</p>
      )}

      {rows.length > 0 && (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[44rem] text-sm">
            <thead className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="px-4 py-3 font-medium">Car</th>
                <th className="px-4 py-3 text-right font-medium">Parts</th>
                <th className="px-4 py-3 text-right font-medium">Spent</th>
                <th className="px-4 py-3 text-right font-medium">Taken</th>
                <th className="px-4 py-3 text-right font-medium">Of that, scrap</th>
                <th className="px-4 py-3 text-right font-medium">Profit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => {
                const profit = signedMoney(row.profit)
                return (
                  <tr key={row.id}>
                    <td className="px-4 py-3">
                      <Link to={`/vehicles/${row.id}`} className="font-medium hover:text-rust">
                        {row.display_name}
                      </Link>
                      <span className="block text-xs text-ink-soft">
                        {row.stock_number} · {VEHICLE_STATUS_LABELS[row.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-ink-soft">
                      {row.parts_sold}/{row.parts_total}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {money(row.total_expenses)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {money(row.total_revenue)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-ink-soft">
                      {Number(row.scrap_revenue) > 0 ? money(row.scrap_revenue) : '—'}
                    </td>
                    <td className={`px-4 py-3 text-right font-semibold tabular-nums ${profit.className}`}>
                      {profit.text}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot className="border-t border-slate-200 font-semibold">
              <tr>
                <td className="px-4 py-3">Every car</td>
                <td />
                <td className="px-4 py-3 text-right tabular-nums">{money(totals.spent)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{money(totals.earned)}</td>
                <td />
                <td
                  className={`px-4 py-3 text-right tabular-nums ${
                    totals.profit >= 0 ? 'text-emerald-700' : 'text-rose-700'
                  }`}
                >
                  {money(totals.profit)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {Number(results.data?.general_expenses ?? 0) > 0 && (
        <p className="mt-2 text-sm text-ink-soft">
          A further {money(results.data!.general_expenses)} of costs belong to no particular car,
          so the profit above is higher than the venture&rsquo;s.
        </p>
      )}
    </section>
  )
}
