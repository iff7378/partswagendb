import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import SuggestInput from '../components/SuggestInput'
import { ErrorNote, Field, PageHeader, Spinner, Stat, StatusChip } from '../components/ui'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import {
  SALE_STATE_LABELS,
  SALE_STATE_STYLES,
  VEHICLE_STATUS_HINTS,
  VEHICLE_STATUS_LABELS,
  date,
  money,
} from '../lib/format'
import type {
  Expense,
  ExpenseCategory,
  Page,
  Part,
  User,
  VehicleDetail,
  VehicleSaleLine,
  VehicleStatus,
  VinDecodeResult,
} from '../lib/types'

const STATUSES: VehicleStatus[] = ['acquired', 'in_teardown', 'stripped', 'scrapped']

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
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { canEdit } = useAuth()
  const [editing, setEditing] = useState(false)

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

  const income = useQuery({
    queryKey: ['vehicle-sales', id],
    queryFn: () => api.get<VehicleSaleLine[]>(`/vehicles/${id}/sales`),
  })

  const remove = useMutation({
    mutationFn: () => api.delete(`/vehicles/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['vehicles'] })
      navigate('/vehicles')
    },
  })

  // Set when the car is moved to scrapped, so we can ask what the yard paid
  // while it is still fresh. Nobody comes back to the Sales page later.
  const [scrapping, setScrapping] = useState(false)

  const setStatus = useMutation({
    mutationFn: (status: VehicleStatus) => api.patch(`/vehicles/${id}`, { status }),
    onSuccess: (_data, status) => {
      void queryClient.invalidateQueries({ queryKey: ['vehicle', id] })
      void queryClient.invalidateQueries({ queryKey: ['vehicles'] })
      if (status === 'scrapped') setScrapping(true)
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
        subtitle={[
          v.nickname ? v.description : null,
          v.stock_number,
          v.vin ?? (v.vin_unknown ? 'VIN unknown' : null),
        ]
          .filter(Boolean)
          .join(' · ')}
        actions={
          canEdit && (
            <>
              <select
                className="field !w-auto"
                value={v.status}
                onChange={(e) => setStatus.mutate(e.target.value as VehicleStatus)}
                title={VEHICLE_STATUS_HINTS[v.status]}
              >
                {STATUSES.map((st) => (
                  <option key={st} value={st}>
                    {VEHICLE_STATUS_LABELS[st]}
                  </option>
                ))}
              </select>
              <button type="button" className="btn-secondary" onClick={() => setEditing(!editing)}>
                {editing ? 'Cancel' : 'Edit car'}
              </button>
            </>
          )
        }
      />

      <p className="-mt-3 mb-4 text-sm text-ink-soft">{VEHICLE_STATUS_HINTS[v.status]}</p>

      {scrapping && <ScrapPanel vehicle={v} onDone={() => setScrapping(false)} />}

      {/* A way back in: the yard's cheque often turns up days after the shell
          leaves, and by then the prompt above is long gone. */}
      {!scrapping && canEdit && v.status === 'scrapped' && Number(v.scrap_revenue) === 0 && (
        <button type="button" className="btn-secondary mb-5" onClick={() => setScrapping(true)}>
          Record what the yard paid
        </button>
      )}

      {editing && <EditVehicle vehicle={v} onDone={() => setEditing(false)} />}

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

      {Number(v.scrap_revenue) > 0 && (
        <p className="mt-2 text-sm text-ink-soft">
          The shell fetched {money(v.scrap_revenue)} at the yard, counted in the profit above.
        </p>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <section className="card divide-y divide-slate-100">
          <h2 className="px-4 py-3 text-sm font-semibold uppercase tracking-wide text-ink-soft">
            The car
          </h2>
          <Row label="VIN">
            {v.vin ? (
              <span className="font-mono">{v.vin}</span>
            ) : v.vin_unknown ? (
              <span className="italic text-ink-soft">Unknown</span>
            ) : (
              '—'
            )}
          </Row>
          <Row label="Year">{v.year ?? '—'}</Row>
          <Row label="Engine">{v.engine ?? '—'}</Row>
          <Row label="Transmission">{v.transmission ?? '—'}</Row>
          <Row label="Body">{v.body_style ?? '—'}</Row>
          <Row label="Colour">{v.color ?? '—'}</Row>
          <Row label="Drive">{v.drive_type ?? '—'}</Row>
          <Row label="Mileage">{v.mileage?.toLocaleString() ?? '—'}</Row>
          <Row label="Acquired">{date(v.acquired_on)}</Row>
          <Row label="From">{v.acquired_from ?? '—'}</Row>
          {v.notes && <Row label="Notes">{v.notes}</Row>}
          {canEdit && (
            <div className="p-4">
              <ErrorNote error={remove.error} />
              <button
                type="button"
                className="btn-danger w-full"
                disabled={remove.isPending}
                onClick={() => {
                  if (confirm(`Delete ${v.display_name}? Its expenses go with it.`)) remove.mutate()
                }}
              >
                Delete this car
              </button>
              <p className="mt-2 text-center text-xs text-ink-soft">
                Only possible once no parts reference it.
              </p>
            </div>
          )}
        </section>

        <section className="space-y-4">
          <div className="card">
            <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold uppercase tracking-wide text-ink-soft">
              Money in
            </h2>
            {income.data?.length === 0 && (
              <p className="px-4 py-6 text-center text-sm text-ink-soft">
                Nothing sold off this car yet.
              </p>
            )}
            <ul className="divide-y divide-slate-100">
              {income.data?.map((line) => (
                <li
                  key={`${line.sale_id}-${line.description}-${line.line_total}`}
                  className="flex items-center justify-between gap-3 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {line.is_shell && (
                        <span className="mr-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-ink-soft">
                          Shell
                        </span>
                      )}
                      {line.description}
                    </p>
                    <p className="text-xs text-ink-soft">
                      <Link to={`/sales?open=${line.sale_id}`} className="hover:text-rust">
                        {line.reference}
                      </Link>{' '}
                      · {date(line.sold_on)}
                      {line.buyer_name && ` · ${line.buyer_name}`}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold tabular-nums">{money(line.line_total)}</p>
                    {!line.paid_on && (
                      <span className={`chip ring-1 ${SALE_STATE_STYLES[line.state]}`}>
                        {SALE_STATE_LABELS[line.state]}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            {(income.data?.some((line) => !line.paid_on) ?? false) && (
              <p className="border-t border-slate-100 px-4 py-2 text-xs text-ink-soft">
                Unpaid lines are listed but do not count towards the profit above.
              </p>
            )}
          </div>

          <div className="card">
            <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold uppercase tracking-wide text-ink-soft">
              Money spent
            </h2>
            {expenses.data?.length === 0 && (
              <p className="px-4 py-6 text-center text-sm text-ink-soft">Nothing recorded yet.</p>
            )}
            <ul className="divide-y divide-slate-100">
              {expenses.data?.map((expense) => (
                <ExpenseRow key={expense.id} expense={expense} canEdit={canEdit} />
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

/**
 * Asked the moment a car is marked scrapped.
 *
 * Scrapping goes one of two ways: the yard weighs the shell in and hands over
 * cash, or it charges to come and take it. The first is revenue and the second
 * is a disposal cost, and the settle-up ledger needs to know which, along with
 * who was holding the money either way.
 */
function ScrapPanel({ vehicle, onDone }: { vehicle: VehicleDetail; onDone: () => void }) {
  const queryClient = useQueryClient()
  const [paidUs, setPaidUs] = useState(true)
  const [form, setForm] = useState({
    amount: '',
    on: new Date().toISOString().slice(0, 10),
    yard: '',
    user_id: '',
  })

  const users = useQuery({ queryKey: ['users'], queryFn: () => api.get<User[]>('/users') })

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['vehicle', String(vehicle.id)] })
    void queryClient.invalidateQueries({ queryKey: ['vehicles'] })
    void queryClient.invalidateQueries({ queryKey: ['expenses'] })
    void queryClient.invalidateQueries({ queryKey: ['sales'] })
    void queryClient.invalidateQueries({ queryKey: ['vehicle-sales'] })
    void queryClient.invalidateQueries({ queryKey: ['by-vehicle'] })
    void queryClient.invalidateQueries({ queryKey: ['settle-up'] })
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
  }

  const record = useMutation({
    mutationFn: () =>
      paidUs
        ? api.post('/sales', {
            sold_on: form.on,
            // The yard has the shell and has paid: nothing is left to arrange,
            // so this is done the moment it is recorded.
            paid_on: form.on,
            fulfilled_on: form.on,
            channel: 'scrap',
            buyer_name: form.yard.trim() || null,
            collected_by_id: Number(form.user_id),
            items: [
              {
                vehicle_id: vehicle.id,
                // Without this the line reads as a lot of parts off the car:
                // it would not count as scrap, would not mark the car
                // scrapped, and would not trip the sold-once guard.
                is_shell: true,
                unit_price: form.amount || '0',
                quantity: 1,
              },
            ],
          })
        : api.post('/expenses', {
            vehicle_id: vehicle.id,
            description: form.yard.trim()
              ? `Scrapped the shell — ${form.yard.trim()}`
              : 'Scrapped the shell',
            category: 'disposal',
            amount: form.amount,
            incurred_on: form.on,
            paid_by_id: Number(form.user_id),
          }),
    onSuccess: () => {
      refresh()
      onDone()
    },
  })

  // Already weighed in, so there is nothing left to ask.
  if (Number(vehicle.scrap_revenue) > 0) return null

  return (
    <form
      className="card mb-5 space-y-3 border-rust/40 p-4"
      onSubmit={(e) => {
        e.preventDefault()
        record.mutate()
      }}
    >
      <ErrorNote error={record.error} />

      <div>
        <p className="text-sm font-semibold">The shell has gone. Did money change hands?</p>
        <p className="mt-1 text-sm text-ink-soft">
          Recording it here keeps this car&rsquo;s profit honest and puts it in the settle-up
          report.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={paidUs ? 'btn-primary' : 'btn-secondary'}
          onClick={() => setPaidUs(true)}
        >
          The yard paid us
        </button>
        <button
          type="button"
          className={paidUs ? 'btn-secondary' : 'btn-primary'}
          onClick={() => setPaidUs(false)}
        >
          We paid to have it taken
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Amount">
          <input
            className="field"
            inputMode="decimal"
            value={form.amount}
            onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))}
            placeholder="180.00"
            required
          />
        </Field>

        <Field label="Date">
          <input
            type="date"
            className="field"
            value={form.on}
            onChange={(e) => setForm((p) => ({ ...p, on: e.target.value }))}
          />
        </Field>

        <Field label="Which yard">
          <SuggestInput
            field="buyer_name"
            className="field"
            value={form.yard}
            onChange={(e) => setForm((p) => ({ ...p, yard: e.target.value }))}
            placeholder="Ace Metals"
          />
        </Field>

        <Field
          label={paidUs ? 'Who took the money' : 'Who paid'}
          hint="This drives the settle-up report."
        >
          <select
            className="field"
            value={form.user_id}
            onChange={(e) => setForm((p) => ({ ...p, user_id: e.target.value }))}
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
        <button type="submit" className="btn-primary flex-1" disabled={record.isPending}>
          {record.isPending ? 'Saving…' : 'Record it'}
        </button>
        <button type="button" className="btn-secondary flex-1" onClick={onDone}>
          Nothing changed hands
        </button>
      </div>
    </form>
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
      void queryClient.invalidateQueries({ queryKey: ['settle-up'] })
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

function ExpenseRow({ expense, canEdit }: { expense: Expense; canEdit: boolean }) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({
    description: expense.description,
    amount: expense.amount,
    incurred_on: expense.incurred_on,
    paid_by_id: String(expense.paid_by_id),
  })

  const users = useQuery({ queryKey: ['users'], queryFn: () => api.get<User[]>('/users') })

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['expenses'] })
    void queryClient.invalidateQueries({ queryKey: ['vehicle'] })
    // Who paid drives the settle-up split, so the report is now stale.
    void queryClient.invalidateQueries({ queryKey: ['settle-up'] })
  }

  const save = useMutation({
    mutationFn: () =>
      api.patch(`/expenses/${expense.id}`, {
        description: form.description.trim(),
        amount: form.amount,
        incurred_on: form.incurred_on,
        paid_by_id: Number(form.paid_by_id),
      }),
    onSuccess: () => {
      refresh()
      setEditing(false)
    },
  })

  const remove = useMutation({
    mutationFn: () => api.delete(`/expenses/${expense.id}`),
    onSuccess: refresh,
  })

  if (!editing) {
    return (
      <li className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{expense.description}</p>
          <p className="text-xs text-ink-soft">
            {date(expense.incurred_on)} · paid by {expense.paid_by.full_name}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-semibold tabular-nums">{money(expense.amount)}</span>
          {canEdit && (
            <button
              type="button"
              className="btn-secondary !px-2 !py-1 !text-xs"
              onClick={() => setEditing(true)}
            >
              Edit
            </button>
          )}
        </div>
      </li>
    )
  }

  return (
    <li className="space-y-3 bg-slate-50 px-4 py-3">
      <ErrorNote error={save.error ?? remove.error} />

      <Field label="What was it for">
        <input
          className="field"
          value={form.description}
          onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Amount">
          <input
            className="field"
            inputMode="decimal"
            value={form.amount}
            onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))}
          />
        </Field>
        <Field label="Date">
          <input
            type="date"
            className="field"
            value={form.incurred_on}
            onChange={(e) => setForm((p) => ({ ...p, incurred_on: e.target.value }))}
          />
        </Field>
        <Field label="Who paid">
          <select
            className="field"
            value={form.paid_by_id}
            onChange={(e) => setForm((p) => ({ ...p, paid_by_id: e.target.value }))}
          >
            {users.data?.map((u) => (
              <option key={u.id} value={u.id}>
                {u.full_name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-primary"
          disabled={save.isPending}
          onClick={() => save.mutate()}
        >
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="btn-secondary" onClick={() => setEditing(false)}>
          Cancel
        </button>
        <button
          type="button"
          className="btn-danger ml-auto"
          onClick={() => {
            if (confirm(`Delete "${expense.description}"? This changes the settle-up report.`)) {
              remove.mutate()
            }
          }}
        >
          Delete
        </button>
      </div>
    </li>
  )
}

function EditVehicle({ vehicle, onDone }: { vehicle: VehicleDetail; onDone: () => void }) {
  const queryClient = useQueryClient()
  const vinFile = useRef<HTMLInputElement>(null)
  const [note, setNote] = useState<string | null>(null)
  const [vinUnknown, setVinUnknown] = useState(vehicle.vin_unknown)
  const [form, setForm] = useState({
    nickname: vehicle.nickname ?? '',
    vin: vehicle.vin ?? '',
    year: vehicle.year ? String(vehicle.year) : '',
    make: vehicle.make ?? '',
    model: vehicle.model ?? '',
    trim: vehicle.trim ?? '',
    engine: vehicle.engine ?? '',
    transmission: vehicle.transmission ?? '',
    drive_type: vehicle.drive_type ?? '',
    body_style: vehicle.body_style ?? '',
    color: vehicle.color ?? '',
    mileage: vehicle.mileage ? String(vehicle.mileage) : '',
    acquired_on: vehicle.acquired_on ?? '',
    acquired_from: vehicle.acquired_from ?? '',
    notes: vehicle.notes ?? '',
  })

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  /** Fill blanks from a decode without clobbering anything already typed. */
  function applyDecode(d: VinDecodeResult) {
    setForm((prev) => ({
      ...prev,
      vin: d.vin,
      year: prev.year || (d.year ? String(d.year) : ''),
      make: prev.make || (d.make ?? ''),
      model: prev.model || (d.model ?? ''),
      trim: prev.trim || (d.trim ?? ''),
      engine: prev.engine || (d.engine ?? ''),
      transmission: prev.transmission || (d.transmission ?? ''),
      drive_type: prev.drive_type || (d.drive_type ?? ''),
      body_style: prev.body_style || (d.body_style ?? ''),
    }))
  }

  const decode = useMutation({
    mutationFn: (vin: string) => api.get<VinDecodeResult>(`/vehicles/decode/${vin}`),
    onSuccess: (d) => {
      applyDecode(d)
      setNote(`Decoded ${[d.year, d.make, d.model, d.trim].filter(Boolean).join(' ')}`)
    },
  })

  const scan = useMutation({
    mutationFn: (file: File) => {
      const body = new FormData()
      body.append('file', file)
      return api.upload<VinDecodeResult>('/vehicles/scan-vin', body)
    },
    onSuccess: (d) => {
      applyDecode(d)
      setVinUnknown(false)
      setNote(`Read ${d.vin} — ${[d.year, d.make, d.model].filter(Boolean).join(' ')}`)
      if (vinFile.current) vinFile.current.value = ''
    },
  })

  const save = useMutation({
    mutationFn: () =>
      api.patch(`/vehicles/${vehicle.id}`, {
        nickname: form.nickname.trim() || null,
        vin: vinUnknown ? null : form.vin.trim() || null,
        vin_unknown: vinUnknown,
        year: form.year ? Number(form.year) : null,
        make: form.make || null,
        model: form.model || null,
        trim: form.trim || null,
        engine: form.engine || null,
        transmission: form.transmission || null,
        drive_type: form.drive_type || null,
        body_style: form.body_style || null,
        color: form.color || null,
        mileage: form.mileage ? Number(form.mileage) : null,
        acquired_on: form.acquired_on || null,
        acquired_from: form.acquired_from || null,
        notes: form.notes || null,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['vehicle', String(vehicle.id)] })
      void queryClient.invalidateQueries({ queryKey: ['vehicles'] })
      onDone()
    },
  })

  return (
    <form
      className="card mb-5 space-y-4 p-4"
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate()
      }}
    >
      <ErrorNote error={save.error ?? decode.error ?? scan.error} />
      {note && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{note}</p>
      )}

      <Field
        label="What you'll call it"
        hint="Used everywhere else in the app. Leave blank to use the year, make and model."
      >
        <input
          className="field"
          value={form.nickname}
          onChange={(e) => set('nickname', e.target.value)}
          placeholder="The silver wagon"
        />
      </Field>

      <Field label="VIN" hint="17 characters. Decoding fills in whatever is still blank.">
        <div className="flex flex-wrap gap-2">
          <input
            className="field font-mono uppercase"
            value={vinUnknown ? '' : form.vin}
            onChange={(e) => set('vin', e.target.value.toUpperCase())}
            maxLength={17}
            disabled={vinUnknown}
          />
          <button
            type="button"
            className="btn-secondary"
            disabled={vinUnknown || form.vin.trim().length !== 17 || decode.isPending}
            onClick={() => decode.mutate(form.vin.trim())}
          >
            {decode.isPending ? 'Looking…' : 'Decode'}
          </button>
        </div>
      </Field>

      <label className="flex items-center gap-2 text-sm text-ink-soft">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-slate-300 text-rust focus:ring-rust"
          checked={vinUnknown}
          onChange={(e) => setVinUnknown(e.target.checked)}
        />
        VIN is unknown — plate missing or unreadable
      </label>

      <Field
        label="Or read the VIN from a photo"
        hint="A registration sticker, the title, or the door jamb plate."
      >
        <input
          ref={vinFile}
          type="file"
          accept="image/*"
          capture="environment"
          className="field"
          disabled={scan.isPending}
          onChange={(e) => e.target.files?.[0] && scan.mutate(e.target.files[0])}
        />
      </Field>
      {scan.isPending && <p className="text-sm text-ink-soft">Reading the photo…</p>}

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Year">
          <input
            className="field"
            inputMode="numeric"
            value={form.year}
            onChange={(e) => set('year', e.target.value)}
          />
        </Field>
        <Field label="Make">
          <input className="field" value={form.make} onChange={(e) => set('make', e.target.value)} />
        </Field>
        <Field label="Model">
          <input
            className="field"
            value={form.model}
            onChange={(e) => set('model', e.target.value)}
          />
        </Field>
        <Field label="Trim">
          <input className="field" value={form.trim} onChange={(e) => set('trim', e.target.value)} />
        </Field>
        <Field label="Engine">
          <input
            className="field"
            value={form.engine}
            onChange={(e) => set('engine', e.target.value)}
          />
        </Field>
        <Field label="Transmission">
          <input
            className="field"
            value={form.transmission}
            onChange={(e) => set('transmission', e.target.value)}
          />
        </Field>
        <Field label="Drive">
          <input
            className="field"
            value={form.drive_type}
            onChange={(e) => set('drive_type', e.target.value)}
          />
        </Field>
        <Field label="Body">
          <input
            className="field"
            value={form.body_style}
            onChange={(e) => set('body_style', e.target.value)}
          />
        </Field>
        <Field label="Colour">
          <input
            className="field"
            value={form.color}
            onChange={(e) => set('color', e.target.value)}
          />
        </Field>
        <Field label="Mileage">
          <input
            className="field"
            inputMode="numeric"
            value={form.mileage}
            onChange={(e) => set('mileage', e.target.value)}
          />
        </Field>
        <Field label="Acquired on">
          <input
            type="date"
            className="field"
            value={form.acquired_on}
            onChange={(e) => set('acquired_on', e.target.value)}
          />
        </Field>
        <Field label="Bought from">
          <SuggestInput
            field="acquired_from"
            className="field"
            value={form.acquired_from}
            onChange={(e) => set('acquired_from', e.target.value)}
          />
        </Field>
      </div>

      <Field label="Notes">
        <textarea
          className="field"
          rows={2}
          value={form.notes}
          onChange={(e) => set('notes', e.target.value)}
        />
      </Field>

      <div className="flex gap-2">
        <button type="submit" className="btn-primary" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save changes'}
        </button>
        <button type="button" className="btn-secondary" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  )
}
