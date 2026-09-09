import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import type { FormEvent } from 'react'

import { ErrorNote, Field } from './ui'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { EXPENSE_CATEGORY_LABELS, date, money } from '../lib/format'
import type { ExpenseCategory, SaleCost, User } from '../lib/types'

// Costs of getting a sale out of the door. Buying a car is never one of them.
const CATEGORIES: ExpenseCategory[] = ['shipping', 'supplies', 'fees', 'transport', 'other']

/**
 * What a sale cost, and which partner paid it.
 *
 * One person can collect the money while the other buys the postage. Without
 * somewhere to put that, the collector appears to have taken the whole amount
 * and the other is quietly out of pocket.
 */
export default function SaleCosts({
  saleId,
  costs,
  netCollected,
  netAfterCosts,
  onChange,
}: {
  saleId: number
  costs: SaleCost[]
  netCollected: string
  netAfterCosts: string
  onChange: () => void
}) {
  const { canEdit } = useAuth()
  const [adding, setAdding] = useState(false)

  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/expenses/${id}`),
    onSuccess: onChange,
  })

  return (
    <div className="rounded-lg border border-slate-200">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
        <p className="text-sm font-semibold">What it cost us</p>
        {canEdit && (
          <button
            type="button"
            className="btn-secondary !px-2 !py-1 !text-xs"
            onClick={() => setAdding(!adding)}
          >
            {adding ? 'Cancel' : 'Add a cost'}
          </button>
        )}
      </div>

      {adding && (
        <AddCost
          saleId={saleId}
          onDone={() => {
            setAdding(false)
            onChange()
          }}
        />
      )}

      {costs.length === 0 && !adding && (
        <p className="px-3 py-3 text-sm text-ink-soft">
          Nothing recorded. Postage, packing and fees go here, against whoever paid them.
        </p>
      )}

      {costs.length > 0 && (
        <>
          <ul className="divide-y divide-slate-100">
            {costs.map((cost) => (
              <li key={cost.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm">{cost.description}</p>
                  <p className="text-xs text-ink-soft">
                    {EXPENSE_CATEGORY_LABELS[cost.category]} · {date(cost.incurred_on)} · paid by{' '}
                    <strong>{cost.paid_by.full_name}</strong>
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold tabular-nums text-rose-700">
                    −{money(cost.amount)}
                  </span>
                  {canEdit && (
                    <button
                      type="button"
                      className="text-xs text-ink-soft hover:text-rose-700"
                      aria-label={`Delete ${cost.description}`}
                      onClick={() => {
                        if (confirm(`Delete "${cost.description}"? The settle-up changes.`)) {
                          remove.mutate(cost.id)
                        }
                      }}
                    >
                      ×
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>

          <dl className="space-y-1 border-t border-slate-200 px-3 py-2 text-sm">
            <div className="flex justify-between text-ink-soft">
              <dt>Collected</dt>
              <dd className="tabular-nums">{money(netCollected)}</dd>
            </div>
            <div className="flex justify-between font-semibold">
              <dt>Kept after costs</dt>
              <dd className="tabular-nums">{money(netAfterCosts)}</dd>
            </div>
          </dl>
        </>
      )}
      <ErrorNote error={remove.error} />
    </div>
  )
}

function AddCost({ saleId, onDone }: { saleId: number; onDone: () => void }) {
  const { user } = useAuth()
  const [form, setForm] = useState({
    description: '',
    amount: '',
    category: 'shipping' as ExpenseCategory,
    incurred_on: new Date().toISOString().slice(0, 10),
    // Defaults to whoever is entering it, which is nearly always who paid.
    paid_by_id: user ? String(user.id) : '',
  })

  const users = useQuery({ queryKey: ['users'], queryFn: () => api.get<User[]>('/users') })

  const create = useMutation({
    mutationFn: () =>
      api.post('/expenses', {
        sale_id: saleId,
        description: form.description.trim(),
        amount: form.amount,
        category: form.category,
        incurred_on: form.incurred_on,
        paid_by_id: Number(form.paid_by_id),
      }),
    onSuccess: onDone,
  })

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    create.mutate()
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 bg-slate-50 p-3">
      <ErrorNote error={create.error} />

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="What was it">
          <input
            className="field"
            value={form.description}
            onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
            placeholder="Shipping label, box and packing…"
            required
            autoFocus
          />
        </Field>

        <Field label="How much">
          <input
            className="field"
            inputMode="decimal"
            value={form.amount}
            onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))}
            placeholder="12.00"
            required
          />
        </Field>

        <Field label="Kind">
          <select
            className="field"
            value={form.category}
            onChange={(e) => setForm((p) => ({ ...p, category: e.target.value as ExpenseCategory }))}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {EXPENSE_CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Who paid" hint="This is what puts it on the right side of the settle-up.">
          <select
            className="field"
            value={form.paid_by_id}
            onChange={(e) => setForm((p) => ({ ...p, paid_by_id: e.target.value }))}
            required
          >
            <option value="">Pick someone</option>
            {users.data?.map((u) => (
              <option key={u.id} value={u.id}>
                {u.full_name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="flex gap-2">
        <button type="button" className="btn-secondary flex-1" onClick={onDone}>
          Cancel
        </button>
        <button type="submit" className="btn-primary flex-1" disabled={create.isPending}>
          {create.isPending ? 'Saving…' : 'Record it'}
        </button>
      </div>
    </form>
  )
}
