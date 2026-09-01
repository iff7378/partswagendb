import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { FormEvent } from 'react'

import { ErrorNote, Field, Spinner } from './ui'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { EXPENSE_CATEGORY_LABELS, date, money } from '../lib/format'
import type { Expense, ExpenseCategory, User } from '../lib/types'

// Buying a car is never an overhead, so it is not offered here.
const CATEGORIES: ExpenseCategory[] = [
  'supplies',
  'meals',
  'tooling',
  'transport',
  'storage',
  'fees',
  'other',
]

/**
 * Costs that belong to the venture rather than to any one car: food, consumables,
 * tools. They count in the settle-up split exactly like a car expense, but they
 * are deliberately kept out of every car's profit, which would otherwise be
 * distorted by whoever happened to buy lunch that day.
 */
export default function GeneralExpenses() {
  const { canEdit } = useAuth()
  const [adding, setAdding] = useState(false)

  const expenses = useQuery({
    queryKey: ['expenses', 'general'],
    queryFn: () => api.get<Expense[]>('/expenses?general=true'),
  })

  const total = (expenses.data ?? []).reduce((sum, e) => sum + Number(e.amount), 0)

  return (
    <section className="mt-8">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-soft">
            Costs not tied to a car
          </h2>
          <p className="text-sm text-ink-soft">
            Food, consumables, tools. These count in the split above but stay out of any
            car&rsquo;s profit.
          </p>
        </div>
        {canEdit && (
          <button type="button" className="btn-secondary" onClick={() => setAdding(!adding)}>
            {adding ? 'Cancel' : 'Record a cost'}
          </button>
        )}
      </div>

      {adding && <AddForm onDone={() => setAdding(false)} />}

      <ErrorNote error={expenses.error} />
      {expenses.isLoading && <Spinner />}

      {expenses.data?.length === 0 && !adding && (
        <p className="card px-4 py-8 text-center text-sm text-ink-soft">
          Nothing recorded yet.
        </p>
      )}

      {(expenses.data?.length ?? 0) > 0 && (
        <div className="card divide-y divide-slate-100">
          {expenses.data?.map((expense) => (
            <Row key={expense.id} expense={expense} canEdit={canEdit} />
          ))}
          <div className="flex items-center justify-between px-4 py-3 font-semibold">
            <span>Total</span>
            <span className="tabular-nums">{money(total)}</span>
          </div>
        </div>
      )}
    </section>
  )
}

function refreshKeys(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: ['expenses'] })
  void queryClient.invalidateQueries({ queryKey: ['settle-up'] })
  void queryClient.invalidateQueries({ queryKey: ['by-vehicle'] })
  void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
}

function AddForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState({
    description: '',
    amount: '',
    category: 'supplies' as ExpenseCategory,
    incurred_on: new Date().toISOString().slice(0, 10),
    paid_by_id: '',
  })

  const users = useQuery({ queryKey: ['users'], queryFn: () => api.get<User[]>('/users') })

  const create = useMutation({
    mutationFn: () =>
      api.post('/expenses', {
        // No vehicle: that is what makes it an overhead.
        vehicle_id: null,
        description: form.description.trim(),
        amount: form.amount,
        category: form.category,
        incurred_on: form.incurred_on,
        paid_by_id: Number(form.paid_by_id),
      }),
    onSuccess: () => {
      refreshKeys(queryClient)
      onDone()
    },
  })

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    create.mutate()
  }

  return (
    <form onSubmit={onSubmit} className="card mb-3 space-y-3 p-4">
      <ErrorNote error={create.error} />

      <Field label="What was it for">
        <input
          className="field"
          value={form.description}
          onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
          placeholder="Cutting discs, lunch on teardown day…"
          required
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Amount">
          <input
            className="field"
            inputMode="decimal"
            value={form.amount}
            onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))}
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

        <Field label="Date">
          <input
            type="date"
            className="field"
            value={form.incurred_on}
            onChange={(e) => setForm((p) => ({ ...p, incurred_on: e.target.value }))}
          />
        </Field>

        <Field label="Who paid" hint="This drives the settle-up report.">
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

function Row({ expense, canEdit }: { expense: Expense; canEdit: boolean }) {
  const queryClient = useQueryClient()

  const remove = useMutation({
    mutationFn: () => api.delete(`/expenses/${expense.id}`),
    onSuccess: () => refreshKeys(queryClient),
  })

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{expense.description}</p>
        <p className="text-xs text-ink-soft">
          {EXPENSE_CATEGORY_LABELS[expense.category]} · {date(expense.incurred_on)} · paid by{' '}
          {expense.paid_by.full_name}
        </p>
        <ErrorNote error={remove.error} />
      </div>
      <div className="flex items-center gap-2">
        <span className="font-semibold tabular-nums">{money(expense.amount)}</span>
        {canEdit && (
          <button
            type="button"
            className="btn-danger !px-2 !py-1 !text-xs"
            disabled={remove.isPending}
            onClick={() => {
              if (confirm(`Delete "${expense.description}"? This changes the settle-up report.`)) {
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
