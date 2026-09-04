import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import GeneralExpenses from '../components/GeneralExpenses'
import MoneyTabs from '../components/MoneyTabs'
import VehicleResults from '../components/VehicleResults'
import { ErrorNote, Field, PageHeader, Spinner, Stat } from '../components/ui'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { date, money, signedMoney } from '../lib/format'
import type { SettleUpReport, Settlement, Transfer, User } from '../lib/types'

/** Calendar quarter containing `today`, which is how the partners reconcile. */
function currentQuarter(today = new Date()): { start: string; end: string } {
  const quarter = Math.floor(today.getMonth() / 3)
  const start = new Date(today.getFullYear(), quarter * 3, 1)
  const end = new Date(today.getFullYear(), quarter * 3 + 3, 0)
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return { start: iso(start), end: iso(end) }
}

export default function Money() {
  const { canEdit } = useAuth()
  const quarter = currentQuarter()
  const [start, setStart] = useState(quarter.start)
  const [end, setEnd] = useState(quarter.end)
  const [paying, setPaying] = useState(false)

  const report = useQuery({
    queryKey: ['settle-up', start, end],
    queryFn: () =>
      api.get<SettleUpReport>(`/settle-up?period_start=${start}&period_end=${end}`),
  })

  const settlements = useQuery({
    queryKey: ['settlements'],
    queryFn: () => api.get<Settlement[]>('/settlements'),
  })

  return (
    <>
      <PageHeader
        title="Money"
        subtitle="Who paid for what, who collected what, and who owes whom"
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
        <button
          type="button"
          className="btn-secondary"
          onClick={() => {
            const q = currentQuarter()
            setStart(q.start)
            setEnd(q.end)
          }}
        >
          This quarter
        </button>
      </div>

      <ErrorNote error={report.error} />
      {report.isLoading && <Spinner />}

      {report.data && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Stat label="Money in" value={money(report.data.total_revenue)} tone="good" />
            <Stat label="Money out" value={money(report.data.total_expenses)} tone="bad" />
            <Stat
              label={Number(report.data.profit) >= 0 ? 'Profit' : 'Loss'}
              value={money(report.data.profit)}
              tone={Number(report.data.profit) >= 0 ? 'good' : 'bad'}
            />
          </div>

          {report.data.unallocated_share_bps !== 0 && (
            <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Partner shares add up to{' '}
              {((10000 - report.data.unallocated_share_bps) / 100).toFixed(0)}%, not 100%. The
              split below will not balance until an admin fixes the shares.
            </p>
          )}

          <VehicleResults />

          <GeneralExpenses />

          <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wide text-ink-soft">
            Where everyone stands
          </h2>

          <div className="card overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-ink-soft">
                <tr>
                  <th className="px-4 py-3 font-medium">Partner</th>
                  <th className="px-4 py-3 text-right font-medium">Share</th>
                  <th className="px-4 py-3 text-right font-medium">Paid out</th>
                  <th className="px-4 py-3 text-right font-medium">Collected</th>
                  <th className="px-4 py-3 text-right font-medium">Holding</th>
                  <th className="px-4 py-3 text-right font-medium">Should hold</th>
                  <th className="px-4 py-3 text-right font-medium">Difference</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {report.data.balances.map((balance) => {
                  const holding = signedMoney(balance.net_holding)
                  const delta = signedMoney(balance.delta)
                  return (
                    <tr key={balance.user.id}>
                      <td className="px-4 py-3 font-medium">{balance.user.full_name}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {(balance.share_bps / 100).toFixed(0)}%
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {money(balance.expenses_paid)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {money(balance.revenue_collected)}
                      </td>
                      <td className={`px-4 py-3 text-right tabular-nums ${holding.className}`}>
                        {holding.text}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {money(balance.entitled)}
                      </td>
                      <td
                        className={`px-4 py-3 text-right font-semibold tabular-nums ${delta.className}`}
                      >
                        {delta.text}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wide text-ink-soft">
            To settle up
          </h2>

          {report.data.transfers.length === 0 ? (
            <p className="card px-4 py-8 text-center text-sm text-ink-soft">
              Everyone is square for this period.
            </p>
          ) : (
            <div className="space-y-2">
              {report.data.transfers.map((transfer, index) => (
                <TransferRow
                  key={index}
                  transfer={transfer}
                  periodStart={start}
                  periodEnd={end}
                  canEdit={canEdit}
                />
              ))}
            </div>
          )}
        </>
      )}

      <div className="mb-3 mt-8 flex flex-wrap items-end justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-soft">
          Already settled
        </h2>
        {canEdit && (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setPaying((open) => !open)}
          >
            {paying ? 'Cancel' : 'Record a payment'}
          </button>
        )}
      </div>

      {paying && (
        <RecordPayment
          periodStart={start}
          periodEnd={end}
          onDone={() => setPaying(false)}
        />
      )}

      {settlements.data?.length === 0 ? (
        <p className="card px-4 py-8 text-center text-sm text-ink-soft">
          No settlements recorded yet.
        </p>
      ) : (
        <div className="card divide-y divide-slate-100">
          {settlements.data?.map((s) => (
            <SettlementRow key={s.id} settlement={s} canEdit={canEdit} />
          ))}
        </div>
      )}
    </>
  )
}

function TransferRow({
  transfer,
  periodStart,
  periodEnd,
  canEdit,
}: {
  transfer: Transfer
  periodStart: string
  periodEnd: string
  canEdit: boolean
}) {
  const queryClient = useQueryClient()

  const record = useMutation({
    mutationFn: () =>
      api.post('/settlements', {
        period_start: periodStart,
        period_end: periodEnd,
        paid_on: new Date().toISOString().slice(0, 10),
        from_user_id: transfer.from_user.id,
        to_user_id: transfer.to_user.id,
        amount: transfer.amount,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['settle-up'] })
      void queryClient.invalidateQueries({ queryKey: ['settlements'] })
    },
  })

  return (
    <div className="card flex flex-wrap items-center justify-between gap-3 p-4">
      <p className="text-sm">
        <strong>{transfer.from_user.full_name}</strong> pays{' '}
        <strong>{transfer.to_user.full_name}</strong>{' '}
        <span className="font-bold tabular-nums">{money(transfer.amount)}</span>
      </p>
      {canEdit && (
        <button
          type="button"
          className="btn-secondary"
          disabled={record.isPending}
          onClick={() => record.mutate()}
        >
          {record.isPending ? 'Recording…' : 'Mark as paid'}
        </button>
      )}
      <ErrorNote error={record.error} />
    </div>
  )
}

function SettlementRow({
  settlement,
  canEdit,
}: {
  settlement: Settlement
  canEdit: boolean
}) {
  const queryClient = useQueryClient()

  const remove = useMutation({
    mutationFn: () => api.delete(`/settlements/${settlement.id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['settlements'] })
      // Removing a settlement reopens the balance it closed.
      void queryClient.invalidateQueries({ queryKey: ['settle-up'] })
    },
  })

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm">
          <strong>{settlement.from_user.full_name}</strong> paid{' '}
          <strong>{settlement.to_user.full_name}</strong>
        </p>
        <p className="text-xs text-ink-soft">
          {date(settlement.paid_on)} · covering {date(settlement.period_start)} to{' '}
          {date(settlement.period_end)}
        </p>
        <ErrorNote error={remove.error} />
      </div>
      <div className="flex items-center gap-2">
        <span className="font-semibold tabular-nums">{money(settlement.amount)}</span>
        {canEdit && (
          <button
            type="button"
            className="btn-danger !px-2 !py-1 !text-xs"
            disabled={remove.isPending}
            onClick={() => {
              if (
                confirm(
                  'Delete this settlement? The balance it closed will reopen and show as ' +
                    'outstanding again.',
                )
              ) {
                remove.mutate()
              }
            }}
          >
            Delete
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * A payment between partners for whatever amount actually changed hands.
 *
 * The one-click button above settles the exact figure the report worked out,
 * which is right when someone clears the whole balance. Part payments and
 * round numbers are just as common -- "here's 200 towards it" -- and without
 * this the only way to record one was to not record it.
 */
function RecordPayment({
  periodStart,
  periodEnd,
  onDone,
}: {
  periodStart: string
  periodEnd: string
  onDone: () => void
}) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState({
    from_user_id: '',
    to_user_id: '',
    amount: '',
    paid_on: new Date().toISOString().slice(0, 10),
    method: '',
    notes: '',
  })

  const users = useQuery({ queryKey: ['users'], queryFn: () => api.get<User[]>('/users') })
  const partners = users.data?.filter((u) => u.is_partner) ?? []

  const create = useMutation({
    mutationFn: () =>
      api.post('/settlements', {
        period_start: periodStart,
        period_end: periodEnd,
        paid_on: form.paid_on,
        from_user_id: Number(form.from_user_id),
        to_user_id: Number(form.to_user_id),
        amount: form.amount,
        method: form.method.trim() || null,
        notes: form.notes.trim() || null,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['settle-up'] })
      void queryClient.invalidateQueries({ queryKey: ['settlements'] })
      onDone()
    },
  })

  const sameParty = form.from_user_id !== '' && form.from_user_id === form.to_user_id

  return (
    <form
      className="card mb-4 space-y-3 p-4"
      onSubmit={(e) => {
        e.preventDefault()
        create.mutate()
      }}
    >
      <ErrorNote error={create.error} />

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Who paid">
          <select
            className="field"
            value={form.from_user_id}
            onChange={(e) => setForm((p) => ({ ...p, from_user_id: e.target.value }))}
            required
          >
            <option value="">Pick someone</option>
            {partners.map((u) => (
              <option key={u.id} value={u.id}>
                {u.full_name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Who received it">
          <select
            className="field"
            value={form.to_user_id}
            onChange={(e) => setForm((p) => ({ ...p, to_user_id: e.target.value }))}
            required
          >
            <option value="">Pick someone</option>
            {partners.map((u) => (
              <option key={u.id} value={u.id}>
                {u.full_name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="How much" hint="Any amount, not just the figure worked out above.">
          <input
            className="field"
            inputMode="decimal"
            value={form.amount}
            onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))}
            placeholder="200.00"
            required
          />
        </Field>

        <Field label="When">
          <input
            type="date"
            className="field"
            value={form.paid_on}
            onChange={(e) => setForm((p) => ({ ...p, paid_on: e.target.value }))}
          />
        </Field>

        <Field label="How" hint="Cash, Venmo, bank transfer…">
          <input
            className="field"
            value={form.method}
            onChange={(e) => setForm((p) => ({ ...p, method: e.target.value }))}
          />
        </Field>

        <Field label="Note">
          <input
            className="field"
            value={form.notes}
            onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
            placeholder="Part payment towards Q3"
          />
        </Field>
      </div>

      {sameParty && (
        <p className="text-sm text-rose-700">
          Paying yourself would not move anything. Pick two different people.
        </p>
      )}

      <div className="flex gap-2">
        <button type="button" className="btn-secondary flex-1" onClick={onDone}>
          Cancel
        </button>
        <button
          type="submit"
          className="btn-primary flex-1"
          disabled={create.isPending || sameParty}
        >
          {create.isPending ? 'Saving…' : 'Record it'}
        </button>
      </div>
    </form>
  )
}
