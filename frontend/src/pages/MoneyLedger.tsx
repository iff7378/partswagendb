import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import MoneyTabs from '../components/MoneyTabs'
import { EmptyState, ErrorNote, PageHeader, Spinner, Stat } from '../components/ui'
import { api } from '../lib/api'
import { SALE_STATE_LABELS, date, money } from '../lib/format'
import type { Ledger, LedgerEntry } from '../lib/types'

/** Calendar quarter containing `today`, matching the summary page. */
function currentQuarter(today = new Date()): { start: string; end: string } {
  const quarter = Math.floor(today.getMonth() / 3)
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate(),
    ).padStart(2, '0')}`
  return {
    start: iso(new Date(today.getFullYear(), quarter * 3, 1)),
    end: iso(new Date(today.getFullYear(), quarter * 3 + 3, 0)),
  }
}

const KINDS = [
  { value: '', label: 'Everything' },
  { value: 'sale', label: 'Money in' },
  { value: 'expense', label: 'Money out' },
  { value: 'settlement', label: 'Settlements' },
]

export default function MoneyLedger() {
  const quarter = currentQuarter()
  const [start, setStart] = useState(quarter.start)
  const [end, setEnd] = useState(quarter.end)
  const [kind, setKind] = useState('')
  const [car, setCar] = useState('')

  const ledger = useQuery({
    queryKey: ['ledger', start, end],
    queryFn: () =>
      api.get<Ledger>(`/reports/ledger?period_start=${start}&period_end=${end}`),
  })

  const all = ledger.data?.entries ?? []
  const cars = [
    ...new Map(
      all.filter((e) => e.vehicle_id).map((e) => [e.vehicle_id!, e.vehicle_name!]),
    ).entries(),
  ].sort((a, b) => a[1].localeCompare(b[1]))

  const shown = all.filter(
    (entry) =>
      (!kind || entry.kind === kind) && (!car || String(entry.vehicle_id) === car),
  )
  // Totals follow the filter, so a filtered view is still checkable.
  const filteredTotal = shown
    .filter((e) => e.counted)
    .reduce((sum, e) => sum + Number(e.amount), 0)

  function exportCsv() {
    const rows = [
      ['date', 'kind', 'reference', 'description', 'car', 'person', 'amount', 'counted'],
      ...shown.map((e) => [
        e.on,
        e.kind,
        e.reference,
        e.description,
        e.vehicle_name ?? '',
        e.person,
        e.amount,
        String(e.counted),
      ]),
    ]
    const csv = rows
      .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(','))
      .join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `partswagen-ledger-${start}-to-${end}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <PageHeader
        title="Money"
        subtitle="Every line behind the summary"
        actions={
          shown.length > 0 && (
            <button type="button" className="btn-secondary" onClick={exportCsv}>
              Export CSV
            </button>
          )
        }
      />
      <MoneyTabs />

      <div className="card mb-5 flex flex-wrap items-end gap-3 p-4">
        <label className="flex-1">
          <span className="label">From</span>
          <input
            type="date"
            className="field"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        <label className="flex-1">
          <span className="label">To</span>
          <input
            type="date"
            className="field"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </label>
        <label>
          <span className="label">Showing</span>
          <select className="field" value={kind} onChange={(e) => setKind(e.target.value)}>
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        {cars.length > 0 && (
          <label>
            <span className="label">Car</span>
            <select className="field" value={car} onChange={(e) => setCar(e.target.value)}>
              <option value="">Any</option>
              {cars.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <ErrorNote error={ledger.error} />
      {ledger.isLoading && <Spinner />}

      {ledger.data && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Stat label="Money in" value={money(ledger.data.money_in)} tone="good" />
            <Stat label="Money out" value={money(ledger.data.money_out)} tone="bad" />
            <Stat
              label={Number(ledger.data.profit) >= 0 ? 'Profit' : 'Loss'}
              value={money(ledger.data.profit)}
              tone={Number(ledger.data.profit) >= 0 ? 'good' : 'bad'}
            />
          </div>

          {Number(ledger.data.uncounted) !== 0 && (
            <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              A further {money(ledger.data.uncounted)} is agreed but not paid. It is listed
              below in grey and counts towards nothing until the money lands.
            </p>
          )}

          {shown.length === 0 ? (
            <div className="mt-5">
              <EmptyState title="Nothing in this period" hint="Try a wider date range." />
            </div>
          ) : (
            <div className="card mt-5 overflow-x-auto">
              <table className="w-full min-w-[46rem] text-sm">
                <thead className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-ink-soft">
                  <tr>
                    <th className="px-4 py-3 font-medium">Date</th>
                    <th className="px-4 py-3 font-medium">What</th>
                    <th className="px-4 py-3 font-medium">Car</th>
                    <th className="px-4 py-3 font-medium">Who</th>
                    <th className="px-4 py-3 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {shown.map((entry, i) => (
                    <Row key={`${entry.kind}-${entry.reference}-${i}`} entry={entry} />
                  ))}
                </tbody>
                <tfoot className="border-t border-slate-200 font-semibold">
                  <tr>
                    <td className="px-4 py-3" colSpan={4}>
                      {kind || car ? 'These lines' : 'Everything above'}
                    </td>
                    <td
                      className={`px-4 py-3 text-right tabular-nums ${
                        filteredTotal >= 0 ? 'text-emerald-700' : 'text-rose-700'
                      }`}
                    >
                      {money(filteredTotal)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </>
      )}
    </>
  )
}

function Row({ entry }: { entry: LedgerEntry }) {
  const amount = Number(entry.amount)
  return (
    <tr className={entry.counted ? '' : 'text-ink-soft'}>
      <td className="whitespace-nowrap px-4 py-2.5">{date(entry.on)}</td>
      <td className="px-4 py-2.5">
        {entry.sale_id ? (
          <Link to={`/sales?open=${entry.sale_id}`} className="hover:text-rust">
            {entry.description}
          </Link>
        ) : (
          entry.description
        )}
        <span className="block text-xs text-ink-soft">
          {entry.reference}
          {!entry.counted && entry.state && ` · ${SALE_STATE_LABELS[entry.state]}, not counted`}
        </span>
      </td>
      <td className="px-4 py-2.5 text-ink-soft">
        {entry.vehicle_id ? (
          <Link to={`/vehicles/${entry.vehicle_id}`} className="hover:text-rust">
            {entry.vehicle_name}
          </Link>
        ) : (
          '—'
        )}
      </td>
      <td className="px-4 py-2.5 text-ink-soft">{entry.person}</td>
      <td
        className={`px-4 py-2.5 text-right tabular-nums ${
          !entry.counted ? '' : amount >= 0 ? 'text-emerald-700' : 'text-rose-700'
        }`}
      >
        {money(entry.amount)}
      </td>
    </tr>
  )
}
