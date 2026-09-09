import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'

import { ErrorNote, Field, Spinner } from './ui'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { date } from '../lib/format'
import { anchorHref, refreshTasks } from '../lib/tasks'
import type { Task, User } from '../lib/types'

export function TaskRow({ task, onChange }: { task: Task; onChange: () => void }) {
  const { canEdit } = useAuth()

  const update = useMutation({
    mutationFn: (patch: Record<string, unknown>) => api.patch(`/tasks/${task.id}`, patch),
    onSuccess: onChange,
  })
  const remove = useMutation({
    mutationFn: () => api.delete(`/tasks/${task.id}`),
    onSuccess: onChange,
  })

  return (
    <li className={`flex items-start gap-3 px-4 py-3 ${task.is_done ? 'opacity-60' : ''}`}>
      <input
        type="checkbox"
        className="mt-0.5 h-5 w-5 shrink-0 rounded border-slate-300 text-rust focus:ring-rust"
        checked={task.is_done}
        disabled={!canEdit || update.isPending}
        onChange={(e) => update.mutate({ done: e.target.checked })}
        aria-label={task.is_done ? `Reopen ${task.title}` : `Finish ${task.title}`}
      />

      <div className="min-w-0 flex-1">
        <p className={`text-sm font-medium ${task.is_done ? 'line-through' : ''}`}>{task.title}</p>
        {task.notes && <p className="text-xs text-ink-soft">{task.notes}</p>}

        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-ink-soft">
          {task.due_on && (
            <span className={task.is_overdue ? 'font-semibold text-rose-700' : ''}>
              {task.is_overdue ? 'Was due ' : 'Due '}
              {date(task.due_on)}
            </span>
          )}
          <span>{task.assigned_to ? task.assigned_to.full_name : 'Anyone'}</span>
          {task.done_by && <span>· done by {task.done_by.full_name}</span>}
        </p>

        {task.anchor && (
          <Link
            to={anchorHref(task.anchor)}
            className="mt-1 inline-block truncate text-xs font-medium text-rust hover:underline"
          >
            {task.anchor.label}
          </Link>
        )}
        <ErrorNote error={update.error ?? remove.error} />
      </div>

      {canEdit && !task.is_done && (
        <TaskActions task={task} onPatch={(patch) => update.mutate(patch)} />
      )}
      {canEdit && (
        <button
          type="button"
          className="shrink-0 text-xs text-ink-soft hover:text-rose-700"
          aria-label={`Delete ${task.title}`}
          onClick={() => {
            if (confirm(`Delete "${task.title}"? Tick it off instead if it is finished.`)) {
              remove.mutate()
            }
          }}
        >
          ×
        </button>
      )}
    </li>
  )
}

/** Claiming and handing over, without opening an edit form. */
function TaskActions({
  task,
  onPatch,
}: {
  task: Task
  onPatch: (patch: Record<string, unknown>) => void
}) {
  const { user } = useAuth()
  const mine = task.assigned_to_id === user?.id

  if (!user) return null

  return (
    <div className="flex shrink-0 gap-1">
      {!mine && (
        <button
          type="button"
          className="btn-secondary !px-2 !py-1 !text-xs"
          onClick={() => onPatch({ assigned_to_id: user.id })}
        >
          {task.assigned_to ? 'Take over' : "I'll do it"}
        </button>
      )}
      {mine && (
        <button
          type="button"
          className="btn-secondary !px-2 !py-1 !text-xs"
          onClick={() => onPatch({ assigned_to_id: null })}
          title="Put it back in the shared pile"
        >
          Hand back
        </button>
      )}
    </div>
  )
}

/**
 * Raising a task. `anchor` pre-attaches it to whatever record it was raised
 * from, which is how most of them start.
 */
export function AddTask({
  anchor,
  onDone,
}: {
  anchor?: { part_id?: number; sale_id?: number; vehicle_id?: number }
  onDone: () => void
}) {
  const { user } = useAuth()
  const [form, setForm] = useState({ title: '', notes: '', assigned_to_id: '', due_on: '' })

  const users = useQuery({ queryKey: ['users'], queryFn: () => api.get<User[]>('/users') })

  const create = useMutation({
    mutationFn: () =>
      api.post('/tasks', {
        title: form.title.trim(),
        notes: form.notes.trim() || null,
        // Empty means anyone: the shared pile is the default on purpose.
        assigned_to_id: form.assigned_to_id ? Number(form.assigned_to_id) : null,
        due_on: form.due_on || null,
        ...anchor,
      }),
    onSuccess: onDone,
  })

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    create.mutate()
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 border-b border-slate-100 bg-slate-50 p-4">
      <ErrorNote error={create.error} />

      <Field label="What needs doing">
        <input
          className="field"
          value={form.title}
          onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
          placeholder="Get detailed photos"
          required
          autoFocus
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Who" hint="Leave as anyone and either of you can pick it up.">
          <select
            className="field"
            value={form.assigned_to_id}
            onChange={(e) => setForm((p) => ({ ...p, assigned_to_id: e.target.value }))}
          >
            <option value="">Anyone</option>
            {user && <option value={user.id}>Me</option>}
            {users.data
              ?.filter((u) => u.id !== user?.id)
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.full_name}
                </option>
              ))}
          </select>
        </Field>

        <Field label="By when" hint="Optional.">
          <input
            type="date"
            className="field"
            value={form.due_on}
            onChange={(e) => setForm((p) => ({ ...p, due_on: e.target.value }))}
          />
        </Field>
      </div>

      <Field label="Any detail">
        <input
          className="field"
          value={form.notes}
          onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
          placeholder="Close-ups of the connector and the casting numbers"
        />
      </Field>

      <div className="flex gap-2">
        <button type="button" className="btn-secondary flex-1" onClick={onDone}>
          Cancel
        </button>
        <button
          type="submit"
          className="btn-primary flex-1"
          disabled={create.isPending || !form.title.trim()}
        >
          {create.isPending ? 'Saving…' : 'Add it'}
        </button>
      </div>
    </form>
  )
}

/** The panel that sits on a part, sale or car page. */
export default function TaskPanel({
  anchor,
  query,
}: {
  anchor: { part_id?: number; sale_id?: number; vehicle_id?: number }
  query: string
}) {
  const { canEdit } = useAuth()
  const queryClient = useQueryClient()
  const [adding, setAdding] = useState(false)

  const tasks = useQuery({
    queryKey: ['tasks', query],
    queryFn: () => api.get<Task[]>(`/tasks?${query}`),
  })
  const doneTasks = useQuery({
    queryKey: ['tasks', query, 'done'],
    queryFn: () => api.get<Task[]>(`/tasks?${query}&done=true`),
  })

  function refresh() {
    refreshTasks(queryClient)
  }

  const open = tasks.data ?? []
  const finished = doneTasks.data ?? []

  return (
    <section className="card mt-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-soft">To do</h2>
          <p className="text-sm text-ink-soft">
            {open.length === 0 ? 'Nothing outstanding.' : `${open.length} outstanding.`}
          </p>
        </div>
        {canEdit && (
          <button type="button" className="btn-secondary" onClick={() => setAdding(!adding)}>
            {adding ? 'Cancel' : 'Add a task'}
          </button>
        )}
      </div>

      {adding && (
        <AddTask
          anchor={anchor}
          onDone={() => {
            setAdding(false)
            refresh()
          }}
        />
      )}

      {tasks.isLoading && <Spinner />}
      <ErrorNote error={tasks.error} />

      <ul className="divide-y divide-slate-100">
        {[...open, ...finished].map((task) => (
          <TaskRow key={task.id} task={task} onChange={refresh} />
        ))}
      </ul>
    </section>
  )
}
