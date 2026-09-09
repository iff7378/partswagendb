import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { AddTask, TaskRow } from '../components/TaskList'
import { refreshTasks } from '../lib/tasks'
import { EmptyState, ErrorNote, PageHeader, Spinner } from '../components/ui'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { date } from '../lib/format'
import type { Task, User } from '../lib/types'

type View = 'mine' | 'free' | 'everyone' | 'done'

const VIEWS: { value: View; label: string }[] = [
  { value: 'mine', label: 'Mine and unclaimed' },
  { value: 'free', label: 'Unclaimed only' },
  { value: 'everyone', label: 'Everyone' },
  { value: 'done', label: 'Finished' },
]

/** Group by when it is due, so the board reads as a plan rather than a pile. */
function group(tasks: Task[]): [string, Task[]][] {
  const today = new Date()
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const buckets = new Map<string, Task[]>()

  for (const task of tasks) {
    let key: string
    if (!task.due_on) {
      key = 'No date'
    } else {
      const [y, m, d] = task.due_on.split('-').map(Number)
      const days = Math.round(
        (startOfDay(new Date(y, m - 1, d)) - startOfDay(today)) / 86_400_000,
      )
      key = days < 0 ? 'Overdue' : days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : date(task.due_on)
    }
    buckets.set(key, [...(buckets.get(key) ?? []), task])
  }
  return [...buckets.entries()]
}

export default function Tasks() {
  const { user, canEdit } = useAuth()
  const queryClient = useQueryClient()
  const [view, setView] = useState<View>('mine')
  const [adding, setAdding] = useState(false)

  const query =
    view === 'mine'
      ? `mine_or_free=${user?.id ?? 0}`
      : view === 'free'
        ? 'unassigned=true'
        : view === 'done'
          ? 'done=true'
          : ''

  const tasks = useQuery({
    queryKey: ['tasks', query],
    queryFn: () => api.get<Task[]>(`/tasks?${query}`),
    enabled: user !== null,
  })

  const users = useQuery({ queryKey: ['users'], queryFn: () => api.get<User[]>('/users') })
  const refresh = () => refreshTasks(queryClient)

  const grouped = group(tasks.data ?? [])

  return (
    <>
      <PageHeader
        title="To do"
        subtitle={
          tasks.data
            ? `${tasks.data.length} ${view === 'done' ? 'finished' : 'outstanding'}`
            : undefined
        }
        actions={
          canEdit && (
            <button type="button" className="btn-primary" onClick={() => setAdding(!adding)}>
              {adding ? 'Cancel' : 'Add a task'}
            </button>
          )
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {VIEWS.map((v) => (
          <button
            key={v.value}
            type="button"
            onClick={() => setView(v.value)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              view === v.value
                ? 'bg-rust text-white'
                : 'bg-slate-100 text-ink-soft hover:bg-slate-200'
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {adding && (
        <div className="card mb-4 overflow-hidden">
          <AddTask
            onDone={() => {
              setAdding(false)
              refresh()
            }}
          />
        </div>
      )}

      <ErrorNote error={tasks.error} />
      {tasks.isLoading && <Spinner />}

      {tasks.data?.length === 0 && !adding && (
        <EmptyState
          title={view === 'done' ? 'Nothing finished yet' : 'Nothing to do'}
          hint={
            view === 'done'
              ? 'Tasks you tick off end up here.'
              : 'Add one here, or from any part, sale or car.'
          }
        />
      )}

      {grouped.map(([heading, group]) => (
        <section key={heading} className="mb-5">
          <h2
            className={`mb-2 text-sm font-semibold uppercase tracking-wide ${
              heading === 'Overdue' ? 'text-rose-700' : 'text-ink-soft'
            }`}
          >
            {heading}
          </h2>
          <ul className="card divide-y divide-slate-100">
            {group.map((task) => (
              <TaskRow key={task.id} task={task} onChange={refresh} />
            ))}
          </ul>
        </section>
      ))}

      {view === 'everyone' && (users.data?.length ?? 0) > 1 && (
        <p className="text-xs text-ink-soft">
          Showing work for everyone. &ldquo;Anyone&rdquo; means nobody has claimed it yet.
        </p>
      )}
    </>
  )
}
