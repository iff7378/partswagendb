import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { EmptyState, ErrorNote, PageHeader, Spinner, StatusChip } from '../components/ui'
import { api, download } from '../lib/api'
import { CONDITION_LABELS, humanAge, money } from '../lib/format'
import type { Category, Page, Part, StorageLocation, Tag, Vehicle } from '../lib/types'

const STATUSES = ['available', 'draft', 'reserved', 'sold', 'scrapped'] as const

const VIEW_KEY = 'pw.partsView'

export default function Parts() {
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState(params.get('q') ?? '')
  const [picked, setPicked] = useState<number[]>([])
  const [view, setView] = useState<'cards' | 'table'>(
    () => (localStorage.getItem(VIEW_KEY) as 'cards' | 'table') ?? 'cards',
  )

  useEffect(() => {
    localStorage.setItem(VIEW_KEY, view)
  }, [view])

  // The default view is what you still have. Sold and scrapped are finished
  // business and sit behind an explicit choice, the same way voided sales do.
  // Done here rather than in the API because a car's page and the sale picker
  // both need the full picture.
  const status = params.get('status') ?? ''
  const query = useMemo(() => {
    const next = new URLSearchParams(params)
    next.delete('status')
    if (status === 'all') {
      // Everything, sold and scrapped included.
    } else if (status) {
      next.set('status', status)
    } else {
      next.set('in_stock', 'true')
    }
    if (!next.has('limit')) next.set('limit', '50')
    return next.toString()
  }, [params, status])

  const parts = useQuery({
    queryKey: ['parts', query],
    queryFn: () => api.get<Page<Part>>(`/parts?${query}`),
  })

  const vehicles = useQuery({
    queryKey: ['vehicles', 'brief'],
    queryFn: () => api.get<Page<Vehicle>>('/vehicles?limit=200'),
  })
  const locations = useQuery({
    queryKey: ['locations'],
    queryFn: () => api.get<StorageLocation[]>('/locations'),
  })
  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.get<Category[]>('/categories'),
  })
  const tags = useQuery({ queryKey: ['tags'], queryFn: () => api.get<Tag[]>('/tags') })

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  return (
    <>
      <PageHeader
        title="Parts"
        subtitle={
          parts.data
            ? `${parts.data.total} ${status === '' ? 'in stock' : 'matching'}`
            : undefined
        }
        actions={
          <>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => void download('/exports/listings', 'listings.csv')}
            >
              Export CSV
            </button>
            <Link to="/parts/new" className="btn-primary">
              Add a part
            </Link>
          </>
        }
      />

      <form
        className="card mb-4 space-y-3 p-4"
        onSubmit={(e) => {
          e.preventDefault()
          setParam('q', search.trim())
        }}
      >
        <div className="flex gap-2">
          <input
            className="field"
            placeholder="Search title, SKU, part number…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button type="submit" className="btn-primary">
            Search
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <select
            className="field"
            value={status}
            onChange={(e) => setParam('status', e.target.value)}
          >
            <option value="">In stock</option>
            <option value="all">Everything, sold included</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s[0].toUpperCase() + s.slice(1)}
              </option>
            ))}
          </select>

          <select
            className="field"
            value={params.get('vehicle_id') ?? ''}
            onChange={(e) => setParam('vehicle_id', e.target.value)}
          >
            <option value="">Any car</option>
            {vehicles.data?.items.map((v) => (
              <option key={v.id} value={v.id}>
                {v.display_name}
              </option>
            ))}
          </select>

          <select
            className="field"
            value={params.get('location_id') ?? ''}
            onChange={(e) => setParam('location_id', e.target.value)}
          >
            <option value="">Anywhere</option>
            {locations.data?.map((l) => (
              <option key={l.id} value={l.id}>
                {l.path}
              </option>
            ))}
          </select>

          <select
            className="field"
            value={params.get('category_id') ?? ''}
            onChange={(e) => setParam('category_id', e.target.value)}
          >
            <option value="">Any category</option>
            {categories.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.path}
              </option>
            ))}
          </select>
        </div>

        {(tags.data?.length ?? 0) > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm text-ink-soft">Tags:</span>
            {tags.data?.map((t) => {
              const active = params.get('tag') === t.name
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setParam('tag', active ? '' : t.name)}
                  className={`chip transition ${
                    active
                      ? 'bg-rust text-white ring-rust'
                      : 'bg-slate-100 text-ink-soft ring-slate-200 hover:bg-slate-200'
                  }`}
                >
                  {t.name}
                </button>
              )
            })}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-ink-soft">
            Missing
            <select
              className="field !w-auto !py-1.5 !text-sm"
              value={params.get('missing') ?? ''}
              onChange={(e) => setParam('missing', e.target.value)}
            >
              <option value="">Nothing in particular</option>
              <option value="photo">No photos</option>
              <option value="part_number">No part number</option>
              <option value="location">Not on a shelf</option>
              <option value="price">No price</option>
            </select>
          </label>

          <label className="flex items-center gap-2 text-sm text-ink-soft">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 text-rust focus:ring-rust"
              checked={params.get('aging') === 'true'}
              onChange={(e) => setParam('aging', e.target.checked ? 'true' : '')}
            />
            Only parts sitting too long
          </label>

          <div className="ml-auto flex items-center gap-1">
            {(['cards', 'table'] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setView(option)}
                className={`rounded-lg px-2.5 py-1 text-sm font-medium transition ${
                  view === option
                    ? 'bg-rust text-white'
                    : 'bg-slate-100 text-ink-soft hover:bg-slate-200'
                }`}
              >
                {option === 'cards' ? 'Cards' : 'Table'}
              </button>
            ))}
          </div>

          <label className="flex items-center gap-2 text-sm text-ink-soft">
            Sort
            <select
              className="field !w-auto !py-1.5 !text-sm"
              value={params.get('sort') ?? 'newest'}
              onChange={(e) => setParam('sort', e.target.value === 'newest' ? '' : e.target.value)}
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="price">Priciest first</option>
              <option value="title">By name</option>
            </select>
          </label>
        </div>
      </form>

      <ErrorNote error={parts.error} />
      {parts.isLoading && <Spinner />}

      {parts.data?.items.length === 0 && (
        <EmptyState
          title="No parts match"
          hint="Try clearing a filter, or add the first part off a donor car."
          action={
            <Link to="/parts/new" className="btn-primary">
              Add a part
            </Link>
          }
        />
      )}

      {picked.length > 0 && (
        <div className="fixed inset-x-0 bottom-16 z-20 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur md:bottom-0">
          <div className="mx-auto flex max-w-6xl items-center gap-3">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setPicked([])}
            >
              Clear
            </button>
            <span className="text-sm text-ink-soft">
              {picked.length} {picked.length === 1 ? 'part' : 'parts'} selected
            </span>
            <Link to={`/sales?parts=${picked.join(',')}`} className="btn-primary ml-auto">
              Sell {picked.length === 1 ? 'it' : 'them together'}
            </Link>
          </div>
        </div>
      )}

      {view === 'table' ? (
        <div className={`card overflow-x-auto ${picked.length > 0 ? 'mb-24' : ''}`}>
          <table className="w-full min-w-[52rem] text-sm">
            <thead className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="w-10 px-3 py-3" />
                <th className="px-3 py-3 font-medium">Part</th>
                <th className="px-3 py-3 font-medium">Status</th>
                <th className="px-3 py-3 font-medium">Car</th>
                <th className="px-3 py-3 font-medium">Shelf</th>
                <th className="px-3 py-3 font-medium">Part number</th>
                <th className="px-3 py-3 text-right font-medium">Price</th>
                <th className="px-3 py-3 text-right font-medium">In stock</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {parts.data?.items.map((part) => (
                <tr key={part.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2">
                    {part.is_sellable && (
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-slate-300 text-rust focus:ring-rust"
                        checked={picked.includes(part.id)}
                        onChange={(e) =>
                          setPicked((prev) =>
                            e.target.checked
                              ? [...prev, part.id]
                              : prev.filter((id) => id !== part.id),
                          )
                        }
                        aria-label={`Select ${part.title}`}
                      />
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <Link to={`/parts/${part.id}`} className="font-medium hover:text-rust">
                      {part.title}
                    </Link>
                    <span className="block font-mono text-xs text-ink-soft">
                      {part.sku} · {CONDITION_LABELS[part.condition]}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <StatusChip status={part.status} />
                  </td>
                  <td className="px-3 py-2 text-ink-soft">
                    {part.vehicle ? (
                      <Link
                        to={`/vehicles/${part.vehicle.id}`}
                        className="hover:text-rust"
                      >
                        {part.vehicle.display_name}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-3 py-2 text-ink-soft">{part.location?.path ?? '—'}</td>
                  <td className="px-3 py-2 font-mono text-xs text-ink-soft">
                    {part.part_number ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">
                    {part.asking_price ? money(part.asking_price) : '—'}
                  </td>
                  <td
                    className={`whitespace-nowrap px-3 py-2 text-right ${
                      part.is_overdue ? 'font-medium text-rose-700' : 'text-ink-soft'
                    }`}
                  >
                    {humanAge(part.days_in_stock)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
      <div
        className={`grid gap-3 sm:grid-cols-2 lg:grid-cols-3 ${picked.length > 0 ? 'pb-24' : ''}`}
      >
        {parts.data?.items.map((part) => (
          <Link
            key={part.id}
            to={`/parts/${part.id}`}
            className="card relative overflow-hidden transition hover:border-rust"
          >
            {part.is_sellable && (
              // Sits over the photo so ticking never opens the part. A large
              // hit area, because this gets used with cold hands.
              <label
                className="absolute left-2 top-2 z-10 grid h-9 w-9 cursor-pointer place-items-center rounded-lg bg-white/90 shadow-sm ring-1 ring-slate-200 backdrop-blur"
                onClick={(e) => e.stopPropagation()}
              >
                <input
                  type="checkbox"
                  className="h-5 w-5 rounded border-slate-300 text-rust focus:ring-rust"
                  checked={picked.includes(part.id)}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) =>
                    setPicked((prev) =>
                      e.target.checked
                        ? [...prev, part.id]
                        : prev.filter((id) => id !== part.id),
                    )
                  }
                  aria-label={`Select ${part.title}`}
                />
              </label>
            )}
            {part.primary_photo_url ? (
              <img
                src={part.primary_photo_url}
                alt=""
                className="h-40 w-full bg-slate-100 object-cover"
              />
            ) : (
              <div className="grid h-40 w-full place-items-center bg-slate-100 text-sm text-ink-soft">
                No photo yet
              </div>
            )}
            <div className="space-y-1.5 p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold leading-tight">{part.title}</p>
                <StatusChip status={part.status} />
              </div>
              <p className="text-xs text-ink-soft">
                {part.sku} · {CONDITION_LABELS[part.condition]}
              </p>
              <p
                className={`text-xs ${
                  part.is_overdue ? 'font-medium text-rose-700' : 'text-ink-soft'
                }`}
              >
                {part.is_overdue ? 'Sitting ' : 'In stock '}
                {humanAge(part.days_in_stock)}
              </p>
              {part.vehicle && (
                <p className="truncate text-xs text-ink-soft">{part.vehicle.display_name}</p>
              )}
              <div className="flex items-center justify-between pt-1">
                <span className="text-sm font-bold">{money(part.asking_price)}</span>
                <span className="truncate text-xs text-ink-soft">
                  {part.location?.path ?? 'Unassigned'}
                </span>
              </div>
            </div>
          </Link>
        ))}
      </div>
      )}

    </>
  )
}
