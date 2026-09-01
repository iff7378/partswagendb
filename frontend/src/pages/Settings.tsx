import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { FormEvent } from 'react'

import { ErrorNote, Field, PageHeader, Spinner } from '../components/ui'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { bytes, money } from '../lib/format'
import type { AppMetrics, Category, User, UserRole } from '../lib/types'

const ROLES: { value: UserRole; label: string; hint: string }[] = [
  { value: 'admin', label: 'Admin', hint: 'Everything, including managing people' },
  { value: 'staff', label: 'Staff', hint: 'Add and edit inventory, record sales' },
  { value: 'viewer', label: 'Viewer', hint: 'Look but not touch' },
]

export default function Settings() {
  const { user, isAdmin } = useAuth()

  return (
    <>
      <PageHeader title="Settings" subtitle={`Signed in as ${user?.email}`} />
      <div className="space-y-6">
        <YourProfile />
        <ChangePassword />
        {isAdmin && <People />}
        {isAdmin && <Categories />}
        {isAdmin && <Metrics />}
      </div>
    </>
  )
}

function YourProfile() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [fullName, setFullName] = useState(user?.full_name ?? '')
  const [email, setEmail] = useState(user?.email ?? '')
  const [done, setDone] = useState(false)

  const save = useMutation({
    mutationFn: () =>
      api.patch(`/users/${user!.id}`, { full_name: fullName.trim(), email: email.trim() }),
    onSuccess: () => {
      setDone(true)
      // The name shows in the header and on every "who paid" dropdown.
      void queryClient.invalidateQueries({ queryKey: ['users'] })
      window.location.reload()
    },
  })

  const unchanged = fullName.trim() === user?.full_name && email.trim() === user?.email

  return (
    <section className="card p-4">
      <h2 className="mb-3 font-semibold">Your details</h2>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault()
          setDone(false)
          save.mutate()
        }}
      >
        <ErrorNote error={save.error} />
        {done && (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">Saved.</p>
        )}

        <Field label="Display name" hint="Shown in the header and on every sale and expense.">
          <input
            className="field"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
          />
        </Field>

        <Field label="Email" hint="Also what you sign in with.">
          <input
            type="email"
            className="field"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </Field>

        <button
          type="submit"
          className="btn-primary"
          disabled={save.isPending || unchanged || !fullName.trim()}
        >
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
      </form>
    </section>
  )
}

function ChangePassword() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [done, setDone] = useState(false)

  const change = useMutation({
    mutationFn: () =>
      api.post('/auth/change-password', { current_password: current, new_password: next }),
    onSuccess: () => {
      setDone(true)
      setCurrent('')
      setNext('')
      setConfirm('')
    },
  })

  const mismatch = confirm.length > 0 && next !== confirm
  const tooShort = next.length > 0 && next.length < 12

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    setDone(false)
    change.mutate()
  }

  return (
    <section className="card p-4">
      <h2 className="mb-3 font-semibold">Your password</h2>
      <form onSubmit={onSubmit} className="space-y-3">
        <ErrorNote error={change.error} />
        {done && (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
            Password changed.
          </p>
        )}

        <Field label="Current password">
          <input
            type="password"
            className="field"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            required
          />
        </Field>

        <Field label="New password" hint="At least 12 characters.">
          <input
            type="password"
            className="field"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password"
            required
          />
        </Field>

        <Field label="Confirm new password">
          <input
            type="password"
            className="field"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            required
          />
        </Field>

        {mismatch && <p className="text-sm text-rose-700">Those do not match.</p>}
        {tooShort && <p className="text-sm text-rose-700">Needs at least 12 characters.</p>}

        <button
          type="submit"
          className="btn-primary"
          disabled={change.isPending || mismatch || tooShort || !current || !next}
        >
          {change.isPending ? 'Changing…' : 'Change password'}
        </button>
      </form>
    </section>
  )
}

function People() {
  const queryClient = useQueryClient()
  const [adding, setAdding] = useState(false)

  const users = useQuery({
    queryKey: ['users', 'all'],
    queryFn: () => api.get<User[]>('/users?include_inactive=true'),
  })

  const update = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Partial<User> }) =>
      api.patch(`/users/${id}`, patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['users'] })
      void queryClient.invalidateQueries({ queryKey: ['settle-up'] })
    },
  })

  if (users.isLoading) return <Spinner />

  const partners = (users.data ?? []).filter((u) => u.is_partner)
  const totalShare = partners.reduce((sum, u) => sum + u.share_bps, 0)
  const shareIsWrong = partners.length > 0 && totalShare !== 10000

  return (
    <section className="card">
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 p-4">
        <h2 className="font-semibold">People</h2>
        <button type="button" className="btn-secondary" onClick={() => setAdding(!adding)}>
          {adding ? 'Cancel' : 'Add someone'}
        </button>
      </div>

      <ErrorNote error={users.error ?? update.error} />

      {adding && <AddUser onDone={() => setAdding(false)} />}

      {shareIsWrong && (
        <p className="m-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Partner shares add up to {(totalShare / 100).toFixed(0)}%, not 100%. The settle-up
          report will not balance until that is fixed.
        </p>
      )}

      <ul className="divide-y divide-slate-100">
        {users.data?.map((u) => (
          <li key={u.id} className="space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <input
                  className="field !py-1.5 font-medium"
                  defaultValue={u.full_name}
                  aria-label={`Display name for ${u.email}`}
                  onBlur={(e) => {
                    const name = e.target.value.trim()
                    if (name && name !== u.full_name) {
                      update.mutate({ id: u.id, patch: { full_name: name } })
                    }
                  }}
                />
                <p className="mt-1 truncate text-xs text-ink-soft">
                  {u.email}
                  {!u.is_active && (
                    <span className="ml-2 chip bg-slate-200 text-slate-700 ring-slate-300">
                      disabled
                    </span>
                  )}
                </p>
              </div>

              <select
                className="field !w-auto !py-1.5 !text-sm"
                value={u.role}
                onChange={(e) =>
                  update.mutate({ id: u.id, patch: { role: e.target.value as UserRole } })
                }
              >
                {ROLES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300 text-rust focus:ring-rust"
                  checked={u.is_partner}
                  onChange={(e) =>
                    update.mutate({
                      id: u.id,
                      patch: {
                        is_partner: e.target.checked,
                        // A non-partner holds no share; leaving one behind would
                        // silently skew the settle-up split.
                        ...(e.target.checked ? {} : { share_bps: 0 }),
                      },
                    })
                  }
                />
                Shares in profits
              </label>

              {u.is_partner && (
                <label className="flex items-center gap-2 text-sm">
                  Share
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    className="field !w-20 !py-1.5 !text-sm"
                    defaultValue={u.share_bps / 100}
                    onBlur={(e) => {
                      const pct = Number(e.target.value)
                      if (Number.isNaN(pct)) return
                      const bps = Math.round(Math.min(100, Math.max(0, pct)) * 100)
                      if (bps !== u.share_bps) update.mutate({ id: u.id, patch: { share_bps: bps } })
                    }}
                  />
                  %
                </label>
              )}

              <label className="flex items-center gap-2 text-sm text-ink-soft">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300 text-rust focus:ring-rust"
                  checked={u.is_active}
                  onChange={(e) =>
                    update.mutate({ id: u.id, patch: { is_active: e.target.checked } })
                  }
                />
                Can sign in
              </label>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

function AddUser({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState({
    full_name: '',
    email: '',
    password: '',
    role: 'staff' as UserRole,
    is_partner: false,
    share: '50',
  })

  const create = useMutation({
    mutationFn: () =>
      api.post('/users', {
        full_name: form.full_name.trim(),
        email: form.email.trim(),
        password: form.password,
        role: form.role,
        is_partner: form.is_partner,
        share_bps: form.is_partner ? Math.round(Number(form.share) * 100) : 0,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['users'] })
      onDone()
    },
  })

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  return (
    <form
      className="space-y-3 border-b border-slate-100 bg-slate-50 p-4"
      onSubmit={(e) => {
        e.preventDefault()
        create.mutate()
      }}
    >
      <ErrorNote error={create.error} />

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name">
          <input
            className="field"
            value={form.full_name}
            onChange={(e) => set('full_name', e.target.value)}
            required
          />
        </Field>

        <Field label="Email">
          <input
            type="email"
            className="field"
            value={form.email}
            onChange={(e) => set('email', e.target.value)}
            required
          />
        </Field>

        <Field label="Password" hint="At least 12 characters. They can change it later.">
          <input
            type="password"
            className="field"
            value={form.password}
            onChange={(e) => set('password', e.target.value)}
            autoComplete="new-password"
            required
          />
        </Field>

        <Field label="Role">
          <select
            className="field"
            value={form.role}
            onChange={(e) => set('role', e.target.value as UserRole)}
          >
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label} — {r.hint}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-slate-300 text-rust focus:ring-rust"
            checked={form.is_partner}
            onChange={(e) => set('is_partner', e.target.checked)}
          />
          Shares in profits
        </label>

        {form.is_partner && (
          <label className="flex items-center gap-2 text-sm">
            Share
            <input
              type="number"
              min={0}
              max={100}
              className="field !w-20 !py-1.5 !text-sm"
              value={form.share}
              onChange={(e) => set('share', e.target.value)}
            />
            %
          </label>
        )}
      </div>

      <button type="submit" className="btn-primary" disabled={create.isPending}>
        {create.isPending ? 'Adding…' : 'Add them'}
      </button>
    </form>
  )
}

function Categories() {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [parentId, setParentId] = useState('')

  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.get<Category[]>('/categories'),
  })

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['categories'] })
  }

  const create = useMutation({
    mutationFn: () =>
      api.post('/categories', {
        name: name.trim(),
        parent_id: parentId ? Number(parentId) : null,
      }),
    onSuccess: () => {
      refresh()
      setName('')
    },
  })

  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/categories/${id}`),
    onSuccess: refresh,
  })

  // Only top-level entries can take children, matching how the tree is seeded.
  const roots = categories.data?.filter((c) => c.parent_id === null) ?? []

  return (
    <section className="card">
      <div className="border-b border-slate-100 p-4">
        <h2 className="font-semibold">Part categories</h2>
        <p className="mt-0.5 text-sm text-ink-soft">
          {categories.data?.length ?? 0} in the tree. Deleting one needs it empty of parts and
          sub-categories.
        </p>
      </div>

      <form
        className="space-y-3 border-b border-slate-100 bg-slate-50 p-4"
        onSubmit={(e) => {
          e.preventDefault()
          create.mutate()
        }}
      >
        <ErrorNote error={create.error} />
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Field label="New category">
            <input
              className="field"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Wiring Harness"
              required
            />
          </Field>
          <Field label="Inside">
            <select
              className="field"
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
            >
              <option value="">Top level</option>
              {roots.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <button type="submit" className="btn-primary" disabled={create.isPending || !name.trim()}>
            {create.isPending ? 'Adding…' : 'Add'}
          </button>
        </div>
      </form>

      <ErrorNote error={remove.error} />

      <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
        {categories.data?.map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-2">
            <span className="truncate text-sm">{c.path}</span>
            <button
              type="button"
              className="btn-danger !px-2 !py-1 !text-xs"
              onClick={() => {
                if (confirm(`Delete "${c.path}"?`)) remove.mutate(c.id)
              }}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** What the system is holding. Admin-only, because it exposes the whole shape
 *  of the operation in one screen. */
function Metrics() {
  const metrics = useQuery({
    queryKey: ['metrics'],
    queryFn: () => api.get<AppMetrics>('/reports/metrics'),
  })

  if (metrics.isLoading) return <Spinner />
  if (metrics.error) return <ErrorNote error={metrics.error} />

  const m = metrics.data!
  const byStatus = (counts: Record<string, number>) =>
    Object.entries(counts)
      .sort(([, a], [, b]) => b - a)
      .map(([status, n]) => `${n} ${status}`)
      .join(' · ') || 'none'

  return (
    <section className="card">
      <div className="border-b border-slate-100 px-4 py-3">
        <h2 className="font-semibold">System</h2>
        <p className="text-sm text-ink-soft">What this install is holding right now.</p>
      </div>

      <dl className="divide-y divide-slate-100">
        <MetricRow label="Parts" value={m.parts_total} hint={byStatus(m.parts_by_status)} />
        <MetricRow label="Cars" value={m.vehicles_total} hint={byStatus(m.vehicles_by_status)} />
        <MetricRow
          label="Sales"
          value={m.sales_total}
          hint={`${m.sale_lines_total} lines · ${money(m.gross_sales)} before fees`}
        />
        <MetricRow
          label="Recorded costs"
          value={m.expenses_total}
          hint={money(m.expenses_amount)}
        />
        <MetricRow label="Settlements" value={m.settlements_total} />
        <MetricRow
          label="Photos"
          value={m.photos_total}
          hint={
            m.photos_total > 0
              ? `${bytes(m.photo_bytes)} stored · largest ${bytes(m.largest_photo_bytes)}`
              : undefined
          }
        />
        {m.database_bytes !== null && (
          <MetricRow label="Database" value={bytes(m.database_bytes)} />
        )}
        <MetricRow
          label="People"
          value={m.users_total}
          hint={`${m.users_active} able to sign in`}
        />
        <MetricRow label="Storage places" value={m.locations_total} />
        <MetricRow
          label="Categories and tags"
          value={`${m.categories_total} / ${m.tags_total}`}
        />
      </dl>

      <p className="border-t border-slate-100 px-4 py-3 text-xs text-ink-soft">
        Photo sizes are what was uploaded after resizing, and exclude thumbnails.
      </p>
    </section>
  )
}

function MetricRow({
  label,
  value,
  hint,
}: {
  label: string
  value: number | string
  hint?: string
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-4 py-2.5">
      <dt className="text-sm text-ink-soft">
        {label}
        {hint && <span className="block text-xs">{hint}</span>}
      </dt>
      <dd className="text-right text-sm font-semibold tabular-nums">{value}</dd>
    </div>
  )
}
