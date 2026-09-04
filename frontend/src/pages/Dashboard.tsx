import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'

import { ErrorNote, PageHeader, Spinner, Stat } from '../components/ui'
import { api } from '../lib/api'
import { dateTime, humanAge, money } from '../lib/format'
import type { DashboardStats, Page, Part, Schedule } from '../lib/types'

export default function Dashboard() {
  const stats = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<DashboardStats>('/dashboard'),
  })

  const drafts = useQuery({
    queryKey: ['parts', 'needs-details'],
    queryFn: () => api.get<Page<Part>>('/parts?missing=location&limit=5'),
  })

  // Today's handovers, because that is the thing with a clock on it.
  const schedule = useQuery({
    queryKey: ['schedule', ''],
    queryFn: () => api.get<Schedule>('/sales/schedule'),
  })

  const aging = useQuery({
    queryKey: ['parts', 'aging'],
    queryFn: () => api.get<Page<Part>>('/parts?aging=true&sort=oldest&limit=5'),
  })

  if (stats.isLoading) return <Spinner />
  if (stats.error) return <ErrorNote error={stats.error} />

  const s = stats.data!

  return (
    <>
      <PageHeader
        title="Today"
        subtitle="Where the operation stands"
        actions={
          <>
            <Link to="/parts/new" className="btn-primary">
              Add a part
            </Link>
            <Link to="/scan" className="btn-secondary">
              Scan
            </Link>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="In stock" value={s.parts_available} />
        <Stat label="Needs details" value={s.parts_draft} tone={s.parts_draft > 0 ? 'bad' : 'good'} />
        <Stat
          label="Sitting too long"
          value={s.parts_overdue}
          tone={s.parts_overdue > 0 ? 'bad' : 'good'}
        />
        <Stat label="Sold" value={s.parts_sold} />
        <Stat label="Donor cars" value={s.vehicles_total} />
      </div>

      {(schedule.data?.scheduled.length ?? 0) > 0 && (
        <div className="mt-8">
          <div className="mb-3 flex items-end justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-soft">
              Coming to collect
            </h2>
            <Link to="/sales/schedule" className="text-sm font-medium text-rust">
              Whole schedule
            </Link>
          </div>
          <div className="card divide-y divide-slate-100">
            {schedule.data?.scheduled.slice(0, 4).map((entry) => (
              <Link
                key={entry.id}
                to={`/sales?open=${entry.id}`}
                className="flex items-center gap-3 px-4 py-3 transition hover:bg-slate-50"
              >
                <span
                  className={`w-32 shrink-0 text-sm font-semibold ${
                    new Date(entry.meetup_at!).getTime() < Date.now() ? 'text-rose-700' : ''
                  }`}
                >
                  {dateTime(entry.meetup_at)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {entry.buyer_name || 'Walk-in buyer'}
                  </span>
                  <span className="block truncate text-xs text-ink-soft">
                    {entry.summary}
                    {entry.site && ` · ${entry.site.name}`}
                  </span>
                </span>
                <span className="text-sm font-semibold tabular-nums">
                  {money(entry.net_collected)}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {(aging.data?.items.length ?? 0) > 0 && (
        <div className="mt-8">
          <div className="mb-3 flex items-end justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-soft">
              Sitting too long
            </h2>
            <Link to="/parts?aging=true&sort=oldest" className="text-sm font-medium text-rust">
              See all
            </Link>
          </div>
          <div className="space-y-2">
            {aging.data?.items.map((part) => (
              <Link
                key={part.id}
                to={`/parts/${part.id}`}
                className="card flex items-center gap-3 p-3 transition hover:border-rust"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{part.title}</p>
                  <p className="truncate text-xs text-ink-soft">
                    {part.sku} · {money(part.asking_price)}
                  </p>
                </div>
                <span className="whitespace-nowrap text-sm font-medium text-rose-700">
                  {humanAge(part.days_in_stock)}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wide text-ink-soft">
        Last 30 days
      </h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Revenue" value={money(s.revenue_last_30_days)} tone="good" />
        <Stat label="Spending" value={money(s.expenses_last_30_days)} tone="bad" />
        <Stat label="Stock at asking price" value={money(s.inventory_asking_value)} />
      </div>

      <div className="mt-8">
        <div className="mb-3 flex items-end justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-soft">
            Not on a shelf yet
          </h2>
          <Link to="/parts?missing=location" className="text-sm font-medium text-rust">
            See all
          </Link>
        </div>

        {drafts.isLoading && <Spinner />}
        {drafts.data?.items.length === 0 && (
          <p className="card px-4 py-8 text-center text-sm text-ink-soft">
            Everything has a home. Nice.
          </p>
        )}

        <div className="space-y-2">
          {drafts.data?.items.map((part) => (
            <Link
              key={part.id}
              to={`/parts/${part.id}`}
              className="card flex items-center gap-3 p-3 transition hover:border-rust"
            >
              {part.primary_photo_url ? (
                <img
                  src={part.primary_photo_url}
                  alt=""
                  className="h-12 w-12 rounded-lg object-cover"
                />
              ) : (
                <div className="grid h-12 w-12 place-items-center rounded-lg bg-slate-100 text-xs text-ink-soft">
                  No photo
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{part.title}</p>
                <p className="truncate text-xs text-ink-soft">
                  {part.sku}
                  {part.vehicle ? ` · ${part.vehicle.display_name}` : ''}
                </p>
              </div>
              <span className="text-xs font-medium text-rust">Finish</span>
            </Link>
          ))}
        </div>
      </div>
    </>
  )
}
