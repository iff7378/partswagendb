import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'

import { Field, StatusChip } from './ui'
import { api } from '../lib/api'
import { money } from '../lib/format'
import { EMPTY_LINE, KIND_LABELS } from '../lib/saleLines'
import type { Line, LineKind } from '../lib/saleLines'
import type { Page, Part, Vehicle } from '../lib/types'

interface Props {
  lines: Line[]
  onChange: (lines: Line[]) => void
  /** Parts already on the sale being edited, which stay selectable. */
  keepPartIds?: number[]
}

export default function SaleLines({ lines, onChange, keepPartIds = [] }: Props) {
  // Draft parts count: filtering to available only is how stock ends up
  // invisible at the till. Anything already on another sale is excluded
  // server-side, so the picker cannot offer something it would then reject.
  const sellable = useQuery({
    queryKey: ['parts', 'sellable'],
    queryFn: () => api.get<Page<Part>>('/parts?sellable=true&limit=200'),
  })
  // Parts on the sale being edited are excluded by that same rule, so they
  // are fetched separately or they would silently drop off on save.
  const onSale = useQuery({
    queryKey: ['parts', 'on-sale', keepPartIds.join(',')],
    queryFn: () => api.get<Page<Part>>('/parts?limit=200'),
    enabled: keepPartIds.length > 0,
  })

  const parts = useMemo(() => {
    const kept = (onSale.data?.items ?? []).filter((p) => keepPartIds.includes(p.id))
    const seen = new Set(kept.map((p) => p.id))
    return [...kept, ...(sellable.data?.items ?? []).filter((p) => !seen.has(p.id))]
  }, [sellable.data, onSale.data, keepPartIds])

  const vehicles = useQuery({
    queryKey: ['vehicles', 'brief'],
    queryFn: () => api.get<Page<Vehicle>>('/vehicles?limit=200'),
  })

  function setLine(index: number, patch: Partial<Line>) {
    onChange(lines.map((line, i) => (i === index ? { ...line, ...patch } : line)))
  }

  // A part on one line must not be offered on another.
  function takenElsewhere(index: number): number[] {
    return lines.flatMap((line, i) => (i === index ? [] : line.partIds))
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-semibold">What sold</p>
        <p className="text-sm text-ink-soft">
          One line per price agreed. Sell a whole lot on one line rather than pricing every piece.
        </p>
      </div>

      {lines.map((line, index) => (
        <div key={index} className="space-y-2 rounded-lg border border-slate-200 p-3">
          <div className="flex flex-wrap items-center gap-2">
            {(Object.keys(KIND_LABELS) as LineKind[]).map((kind) => (
              <button
                key={kind}
                type="button"
                className={
                  line.kind === kind
                    ? 'rounded-full bg-rust px-3 py-1 text-xs font-semibold text-white'
                    : 'rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-ink-soft'
                }
                onClick={() => setLine(index, { kind, partIds: [], vehicleId: '' })}
              >
                {KIND_LABELS[kind]}
              </button>
            ))}
            {lines.length > 1 && (
              <button
                type="button"
                className="ml-auto text-xs font-semibold text-rose-700 underline"
                onClick={() => onChange(lines.filter((_, i) => i !== index))}
              >
                Remove line
              </button>
            )}
          </div>

          {line.kind === 'parts' && (
            <PartPicker
              parts={parts.filter((p) => !takenElsewhere(index).includes(p.id))}
              selected={line.partIds}
              loading={sellable.isLoading}
              onToggle={(id) => {
                const next = line.partIds.includes(id)
                  ? line.partIds.filter((p) => p !== id)
                  : [...line.partIds, id]
                const picked = parts.filter((p) => next.includes(p.id))
                setLine(index, {
                  partIds: next,
                  // One part: price it at its asking price. A lot gets one
                  // negotiated price, so leave that alone.
                  unit_price:
                    next.length === 1
                      ? (picked[0]?.asking_price ?? line.unit_price)
                      : line.unit_price,
                  description: next.length > 1 ? line.description : '',
                })
              }}
            />
          )}

          {line.kind !== 'parts' && (
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label={line.kind === 'shell' ? 'Which car' : 'Off which car'}>
                <select
                  className="field"
                  value={line.vehicleId}
                  onChange={(e) => setLine(index, { vehicleId: e.target.value })}
                >
                  <option value="">
                    {line.kind === 'shell' ? 'Pick a car' : 'Not from a car'}
                  </option>
                  {vehicles.data?.items
                    .filter((v) => line.kind !== 'shell' || v.status !== 'scrapped')
                    .map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.display_name}
                      </option>
                    ))}
                </select>
              </Field>

              <Field label="What it was">
                <input
                  className="field"
                  value={line.description}
                  onChange={(e) => setLine(index, { description: e.target.value })}
                  placeholder={line.kind === 'shell' ? 'Shell scrapped' : 'The entire interior'}
                />
              </Field>
            </div>
          )}

          {line.kind === 'parts' && line.partIds.length > 1 && (
            <Field label="Call the lot" hint="Shown on the sale instead of every part name.">
              <input
                className="field"
                value={line.description}
                onChange={(e) => setLine(index, { description: e.target.value })}
                placeholder="The entire interior"
              />
            </Field>
          )}

          <div className="grid gap-2 sm:grid-cols-[1fr_6rem_auto]">
            <Field label={line.partIds.length > 1 ? 'Price for the lot' : 'Price'}>
              <input
                className="field"
                inputMode="decimal"
                value={line.unit_price}
                onChange={(e) => setLine(index, { unit_price: e.target.value })}
                placeholder="85.00"
              />
            </Field>
            <Field label="Qty">
              <input
                className="field"
                inputMode="numeric"
                value={line.quantity}
                onChange={(e) => setLine(index, { quantity: e.target.value })}
              />
            </Field>
            <div className="flex items-end pb-1 text-sm text-ink-soft">
              {money((Number(line.unit_price) || 0) * (Number(line.quantity) || 1))}
            </div>
          </div>
        </div>
      ))}

      <button
        type="button"
        className="btn-secondary"
        onClick={() => onChange([...lines, { ...EMPTY_LINE }])}
      >
        Add another line
      </button>
    </div>
  )
}

function PartPicker({
  parts,
  selected,
  loading,
  onToggle,
}: {
  parts: Part[]
  selected: number[]
  loading: boolean
  onToggle: (id: number) => void
}) {
  const [filter, setFilter] = useState('')

  const shown = useMemo(() => {
    const term = filter.trim().toLowerCase()
    if (!term) return parts
    return parts.filter(
      (p) =>
        p.title.toLowerCase().includes(term) ||
        p.sku.toLowerCase().includes(term) ||
        (p.part_number ?? '').toLowerCase().includes(term) ||
        (p.vehicle?.display_name ?? '').toLowerCase().includes(term) ||
        (p.location?.code ?? '').toLowerCase().includes(term),
    )
  }, [parts, filter])

  return (
    <div className="space-y-2">
      <input
        className="field"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Search stock by name, SKU, part number, car or shelf…"
      />

      {loading && <p className="text-sm text-ink-soft">Loading stock…</p>}
      {!loading && parts.length === 0 && (
        <p className="text-sm text-ink-soft">
          Nothing left in stock to sell. Use &ldquo;Not itemised&rdquo; for something that was never
          catalogued.
        </p>
      )}

      {parts.length > 0 && (
        <div className="max-h-60 overflow-y-auto rounded-lg border border-slate-200">
          {shown.length === 0 && (
            <p className="px-3 py-4 text-center text-sm text-ink-soft">Nothing matches that.</p>
          )}
          {shown.map((part) => (
            <label
              key={part.id}
              className="flex cursor-pointer items-center gap-3 border-b border-slate-100 px-3 py-2 last:border-b-0 hover:bg-slate-50"
            >
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 text-rust focus:ring-rust"
                checked={selected.includes(part.id)}
                onChange={() => onToggle(part.id)}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{part.title}</span>
                <span className="block truncate text-xs text-ink-soft">
                  <span className="font-mono">{part.sku}</span>
                  {/* Three identical "Emissions System" rows are impossible to
                      tell apart on SKU alone; the car is what you actually
                      know the part by. */}
                  {part.vehicle && ` · ${part.vehicle.display_name}`}
                  {part.location && ` · ${part.location.code}`}
                </span>
              </span>
              <StatusChip status={part.status} />
              <span className="w-16 text-right text-sm tabular-nums text-ink-soft">
                {part.asking_price ? money(part.asking_price) : '—'}
              </span>
            </label>
          ))}
        </div>
      )}

      {selected.length > 1 && (
        <p className="text-sm text-ink-soft">
          {selected.length} parts on this line, sold together for one price.
        </p>
      )}
    </div>
  )
}
