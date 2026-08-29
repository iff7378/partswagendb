import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'

import { ErrorNote, Field, PageHeader, Spinner, Stat, StatusChip } from '../components/ui'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { date, money } from '../lib/format'
import type {
  Expense,
  ExpenseCategory,
  Page,
  Part,
  User,
  VehicleDetail,
  VehicleStatus,
} from '../lib/types'

const STATUSES: VehicleStatus[] = ['acquired', 'teardown', 'complete', 'scrapped']

const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  'purchase',
  'transport',
  'tooling',
  'disposal',
  'storage',
  'fees',
  'other',
]

export default function VehicleDetailPage() {
  const { id } = useParams()
  const queryClient = useQueryClient()
  const { canEdit } = useAuth()

  const vehicle = useQuery({
    queryKey: ['vehicle', id],
    queryFn: () => api.get<VehicleDetail>(`/vehicles/${id}`),
  })

  const parts = useQuery({
    queryKey: ['parts', 'vehicle', id],
    queryFn: () => api.get<Page<Part>>(`/parts?vehicle_id=${id}&limit=200`),
  })

  const expenses = useQuery({
    queryKey: ['expenses', 'vehicle', id],
    queryFn: () => api.get<Expense[]>(`/expenses?vehicle_id=${id}`),
  })

  const setStatus = useMutation({
    mutationFn: (status: VehicleStatus) => api.patch(`/vehicles/${id}`, { status }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['vehicle', id] })
      void queryClient.invalidateQueries({ queryKey: ['vehicles'] })
    },
  })

  if (vehicle.isLoading) return <Spinner />
  if (vehicle.error) return <ErrorNote error={vehicle.error} />

  const v = vehicle.data!
  const profit = Number(v.profit)

  return (
    <>
      <PageHeader
        title={v.display_name}
        subtitle={`${v.stock_number}${v.vin ? ` · ${v.vin}` : ''}`}
        actions={
          canEdit && (
            <select
              className="field !w-auto"
              value={v.status}
              onChange={(e) => setStatus.mutate(e.target.value as VehicleStatus)}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s[0].toUpperCase() + s.slice(1)}
                </option>
              ))}
            </select>
          )
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Parts pulled" value={v.part_count} />
        <Stat label="Parts sold" value={v.parts_sold} />
        <Stat label="Spent" value={money(v.total_expenses)} tone="bad" />
        <Stat
          label={profit >= 0 ? 'Profit' : 'Still down'}
          value={money(v.profit)}
          tone={profit >= 0 ? 'good' : 'bad'}
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <section className="card divide-y divide-slate-100">
          <h2 className="px-4 py-3 text-sm font-semibold uppercase tracking-wide text-ink-soft">
            The car
          </h2>
          <Row label="Year">{v.year ?? '—'}</Row>
          <Row label="Engine">{v.engine ?? '—'}</Row>
          <Row label="Transmission">{v.transmission ?? '—'}</Row>
          <Row label="Body">{v.body_style ?? '—'}</Row>
          <Row label="Drive">{v.drive_type ?? '—'}</Row>
          <Row label="Mileage">{v.mileage?.toLocaleString() ?? '—'}</Row>
          <Row label="Acquired">{date(v.acquired_on)}</Row>
          <Row label="From">{v.acquired_from ?? '—'}</Row>
          {v.notes && <Row label="Notes">{v.notes}</Row>}
        </section>

        <section>
          <div className="card">
            <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold uppercase tracking-wide text-ink-soft">
              Money spent
            </h2>
            {expenses.data?.length === 0 && (
              <p className="px-4 py-6 text-center text-sm text-ink-soft">Nothing recorded yet.</p>
            )}
            <ul className="divide-y divide-slate-100">
              {expenses.data?.map((expense) => (
                <li key={expense.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{expense.description}</p>
                    <p className="text-xs text-ink-soft">
                      {date(expense.incurred_on)} · paid by {expense.paid_by.full_name}
                    </p>
                  </div>
                  <span className="font-semibold tabular-nums">{money(expense.amount)}</span>
                </li>
              ))}
            </ul>
          </div>

          {canEdit && <AddExpenseForm vehicleId={Number(id)} />}
        </section>
      </div>

      <div className="mt-6">
        <div className="mb-3 flex items-end justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-soft">
            Parts off this car
          </h2>
          <Link to={`/parts?vehicle_id=${id}`} className="text-sm font-medium text-rust">
            Open in parts
          </Link>
        </div>

        {parts.data?.items.length === 0 && (
          <p className="card px-4 py-8 text-center text-sm text-ink-soft">
            Nothing pulled off this car yet.
          </p>
        )}

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {parts.data?.items.map((part) => (
            <Link
              key={part.id}
              to={`/parts/${part.id}`}
              className="card flex items-center justify-between gap-3 p-3 transition hover:border-rust"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{part.title}</p>
                <p className="text-xs text-ink-soft">{part.sku}</p>
              </div>
              <StatusChip status={part.status} />
            </Link>
          ))}
        </div>
      </div>
    </>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-2.5">
      <span className="text-sm text-ink-soft">{label}</span>
      <span className="text-right text-sm">{children}</span>
    </div>
  )
}

function AddExpenseForm({ vehicleId }: { vehicleId: number }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({
    description: '',
    amount: '',
    category: 'purchase' as ExpenseCategory,
    incurred_on: new Date().toISOString().slice(0, 10),
    paid_by_id: '',
  })

  const users = useQuery({ queryKey: ['users'], queryFn: () => api.get<User[]>('/users') })

  const create = useMutation({
    mutationFn: () =>
      api.post('/expenses', {
        vehicle_id: vehicleId,
        description: form.description.trim(),
        amount: form.amount,
        category: form.category,
        incurred_on: form.incurred_on,
        paid_by_id: Number(form.paid_by_id),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['expenses'] })
      void queryClient.invalidateQueries({ queryKey: ['vehicle'] })
      setForm((prev) => ({ ...prev, description: '', amount: '' }))
      setOpen(false)
    },
  })

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    create.mutate()
  }

  if (!open) {
    return (
      <button type="button" className="btn-secondary mt-3 w-full" onClick={() => setOpen(true)}>
        Record something you spent
      </button>
    )
  }

  return (
    <form onSubmit={onSubmit} className="card mt-3 space-y-3 p-4">
      <ErrorNote error={create.error} />

      <Field label="What was it for">
        <input
          className="field"
          value={form.description}
          onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
          placeholder="Bought the car, towing, scrap fee…"
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

        <Field label="Category">
          <select
            className="field"
            value={form.category}
            onChange={(e) => setForm((p) => ({ ...p, category: e.target.value as ExpenseCategory }))}
          >
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c[0].toUpperCase() + c.slice(1)}
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
        <button type="button" className="btn-secondary flex-1" onClick={() => setOpen(false)}>
          Cancel
        </button>
        <button type="submit" className="btn-primary flex-1" disabled={create.isPending}>
          {create.isPending ? 'Saving…' : 'Record it'}
        </button>
      </div>
    </form>
  )
}
