import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import SalesTabs from '../components/SalesTabs'
import { EmptyState, ErrorNote, PageHeader, Spinner } from '../components/ui'
import { api } from '../lib/api'
import {
  SALE_STATE_LABELS,
  SALE_STATE_STYLES,
  dayLabel,
  money,
  timeOfDay,
} from '../lib/format'
import type { Schedule, ScheduleEntry } from '../lib/types'

/** Group the diary by calendar day, keeping the order the API sent. */
function byDay(entries: ScheduleEntry[]): [string, ScheduleEntry[]][] {
  const days = new Map<string, ScheduleEntry[]>()
  for (const entry of entries) {
    const key = new Date(entry.meetup_at!).toDateString()
    days.set(key, [...(days.get(key) ?? []), entry])
  }
  return [...days.entries()]
}

export default function SaleSchedule() {
  const [siteId, setSiteId] = useState('')

  const schedule = useQuery({
    queryKey: ['schedule', siteId],
    queryFn: () =>
      api.get<Schedule>(`/sales/schedule${siteId ? `?site_id=${siteId}` : ''}`),
    // Someone may be marking pickups off on a phone while this is open.
    refetchInterval: 60_000,
  })

  const header = (
    <>
      <PageHeader title="Sales" subtitle="Who is coming, and when" />
      <SalesTabs />
    </>
  )

  if (schedule.isLoading)
    return (
      <>
        {header}
        <Spinner />
      </>
    )
  if (schedule.error)
    return (
      <>
        {header}
        <ErrorNote error={schedule.error} />
      </>
    )

  const data = schedule.data!
  const now = Date.now()
  const overdue = data.scheduled.filter((e) => new Date(e.meetup_at!).getTime() < now)
  const upcoming = data.scheduled.filter((e) => new Date(e.meetup_at!).getTime() >= now)

  return (
    <>
      {header}

      {data.sites.length > 1 && (
        <div className="card mb-5 flex flex-wrap items-center gap-3 p-4">
          <label className="flex items-center gap-2 text-sm text-ink-soft">
            Site
            <select
              className="field !w-auto !py-1.5 !text-sm"
              value={siteId}
              onChange={(e) => setSiteId(e.target.value)}
            >
              <option value="">Everywhere</option>
              {data.sites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {data.scheduled.length === 0 && data.unscheduled.length === 0 && (
        <EmptyState
          title="Nothing to hand over"
          hint="Sales with a pickup time arranged show up here."
        />
      )}

      {overdue.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-rose-700">
            Should already have happened
          </h2>
          <p className="mb-2 text-sm text-ink-soft">
            The time has passed and nobody has marked these collected.
          </p>
          <div className="card divide-y divide-slate-100">
            {overdue.map((entry) => (
              <Row key={entry.id} entry={entry} showDay />
            ))}
          </div>
        </section>
      )}

      {byDay(upcoming).map(([day, entries]) => (
        <section key={day} className="mb-6">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-soft">
            {dayLabel(entries[0].meetup_at!)}
          </h2>
          <div className="card divide-y divide-slate-100">
            {entries.map((entry) => (
              <Row key={entry.id} entry={entry} />
            ))}
          </div>
        </section>
      ))}

      {data.unscheduled.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-soft">
            No time arranged yet
          </h2>
          <div className="card divide-y divide-slate-100">
            {data.unscheduled.map((entry) => (
              <Row key={entry.id} entry={entry} />
            ))}
          </div>
        </section>
      )}
    </>
  )
}

function Row({ entry, showDay = false }: { entry: ScheduleEntry; showDay?: boolean }) {
  return (
    <Link
      to={`/sales?open=${entry.id}`}
      className="flex flex-wrap items-center gap-3 px-4 py-3 transition hover:bg-slate-50"
    >
      <div className="w-20 shrink-0 text-sm font-semibold tabular-nums">
        {entry.meetup_at ? (
          showDay ? (
            <span className="text-rose-700">{dayLabel(entry.meetup_at)}</span>
          ) : (
            timeOfDay(entry.meetup_at)
          )
        ) : (
          <span className="text-ink-soft">—</span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {entry.buyer_name || 'Walk-in buyer'}
          {entry.buyer_contact && (
            <span className="font-normal text-ink-soft"> · {entry.buyer_contact}</span>
          )}
        </p>
        <p className="truncate text-xs text-ink-soft">
          {entry.summary}
          {entry.site && ` · ${entry.site.name}`}
        </p>
      </div>

      <div className="text-right">
        <p className="font-semibold tabular-nums">{money(entry.net_collected)}</p>
        <span className={`chip ring-1 ${SALE_STATE_STYLES[entry.state]}`}>
          {entry.paid_on ? 'Paid' : SALE_STATE_LABELS[entry.state]}
        </span>
      </div>
    </Link>
  )
}
