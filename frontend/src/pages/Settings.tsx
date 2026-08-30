import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { FormEvent } from 'react'

import { ErrorNote, Field, PageHeader, Spinner } from '../components/ui'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import type { User, UserRole } from '../lib/types'

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
        <ChangePassword />
        {isAdmin && <People />}
      </div>
    </>
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
              <div className="min-w-0">
                <p className="truncate font-medium">
                  {u.full_name}
                  {!u.is_active && (
                    <span className="ml-2 chip bg-slate-200 text-slate-700 ring-slate-300">
                      disabled
                    </span>
                  )}
                </p>
                <p className="truncate text-xs text-ink-soft">{u.email}</p>
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
