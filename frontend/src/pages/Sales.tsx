import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { FormEvent } from 'react'

import { EmptyState, ErrorNote, Field, PageHeader, Spinner } from '../components/ui'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { date, money } from '../lib/format'
import type { Page, Part, Sale, SaleChannel, User } from '../lib/types'

const CHANNELS: SaleChannel[] = ['local', 'ebay', 'facebook', 'phone', 'other']

export default function Sales() {
  const { canEdit } = useAuth()
  const [adding, setAdding] = useState(false)

  const sales = useQuery({
    queryKey: ['sales'],
    queryFn: () => api.get<Page<Sale>>('/sales?limit=100'),
  })

  return (
    <>
      <PageHeader
        title="Sales"
        subtitle={sales.data ? `${sales.data.total} recorded` : undefined}
        actions={
          canEdit && (
            <button type="button" className="btn-primary" onClick={() => setAdding(!adding)}>
              {adding ? 'Cancel' : 'Record a sale'}
            </button>
          )
        }
      />

      {adding && <NewSaleForm onDone={() => setAdding(false)} />}

      <ErrorNote error={sales.error} />
      {sales.isLoading && <Spinner />}

      {sales.data?.items.length === 0 && !adding && (
        <EmptyState
          title="No sales yet"
          hint="Record one and it will feed straight into the settle-up report."
        />
      )}

      <div className="card divide-y divide-slate-100">
        {sales.data?.items.map((sale) => (
          <div key={sale.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {sale.buyer_name || 'Walk-in buyer'}{' '}
                <span className="font-normal text-ink-soft">via {sale.channel}</span>
              </p>
              <p className="text-xs text-ink-soft">
                {sale.reference} · {date(sale.sold_on)} · collected by{' '}
                {sale.collected_by.full_name}
              </p>
            </div>
            <div className="text-right">
              <p className="font-semibold tabular-nums">{money(sale.net_collected)}</p>
              {Number(sale.fees) > 0 && (
                <p className="text-xs text-ink-soft">after {money(sale.fees)} fees</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

interface Line {
  part_id: string
  description: string
  unit_price: string
  quantity: string
}

const EMPTY_LINE: Line = { part_id: '', description: '', unit_price: '', quantity: '1' }

function NewSaleForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState({
    sold_on: new Date().toISOString().slice(0, 10),
    channel: 'local' as SaleChannel,
    buyer_name: '',
    collected_by_id: '',
    shipping: '',
    fees: '',
    tax: '',
  })
  const [lines, setLines] = useState<Line[]>([{ ...EMPTY_LINE }])

  const users = useQuery({ queryKey: ['users'], queryFn: () => api.get<User[]>('/users') })
  const available = useQuery({
    queryKey: ['parts', 'available'],
    queryFn: () => api.get<Page<Part>>('/parts?status=available&limit=200'),
  })

  const create = useMutation({
    mutationFn: () =>
      api.post('/sales', {
        sold_on: form.sold_on,
        channel: form.channel,
        buyer_name: form.buyer_name || null,
        collected_by_id: Number(form.collected_by_id),
        shipping: form.shipping || '0',
        fees: form.fees || '0',
        tax: form.tax || '0',
        items: lines
          .filter((line) => line.part_id || line.description.trim())
          .map((line) => ({
            part_id: line.part_id ? Number(line.part_id) : null,
            description: line.description.trim() || null,
            unit_price: line.unit_price || '0',
            quantity: Number(line.quantity) || 1,
          })),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sales'] })
      void queryClient.invalidateQueries({ queryKey: ['parts'] })
      void queryClient.invalidateQueries({ queryKey: ['settle-up'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      onDone()
    },
  })

  function setLine(index: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)))
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    create.mutate()
  }

  const subtotal = lines.reduce(
    (sum, line) => sum + (Number(line.unit_price) || 0) * (Number(line.quantity) || 1),
    0,
  )
  const net = subtotal + Number(form.shipping || 0) + Number(form.tax || 0) - Number(form.fees || 0)

  return (
    <form onSubmit={onSubmit} className="card mb-5 space-y-4 p-4">
      <ErrorNote error={create.error} />

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Sold on">
          <input
            type="date"
            className="field"
            value={form.sold_on}
            onChange={(e) => setForm((p) => ({ ...p, sold_on: e.target.value }))}
          />
        </Field>

        <Field label="Where">
          <select
            className="field"
            value={form.channel}
            onChange={(e) => setForm((p) => ({ ...p, channel: e.target.value as SaleChannel }))}
          >
            {CHANNELS.map((c) => (
              <option key={c} value={c}>
                {c[0].toUpperCase() + c.slice(1)}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Buyer">
          <input
            className="field"
            value={form.buyer_name}
            onChange={(e) => setForm((p) => ({ ...p, buyer_name: e.target.value }))}
          />
        </Field>

        <Field label="Who took the money" hint="This drives the settle-up report.">
          <select
            className="field"
            value={form.collected_by_id}
            onChange={(e) => setForm((p) => ({ ...p, collected_by_id: e.target.value }))}
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

      <div className="space-y-2">
        <p className="text-sm font-semibold">What sold</p>
        {lines.map((line, index) => (
          <div key={index} className="grid gap-2 sm:grid-cols-[2fr_1fr_5rem_auto]">
            <select
              className="field"
              value={line.part_id}
              onChange={(e) => {
                const part = available.data?.items.find((p) => String(p.id) === e.target.value)
                setLine(index, {
                  part_id: e.target.value,
                  unit_price: part?.asking_price ?? line.unit_price,
                })
              }}
            >
              <option value="">Something not in inventory</option>
              {available.data?.items.map((part) => (
                <option key={part.id} value={part.id}>
                  {part.sku} · {part.title}
                </option>
              ))}
            </select>

            {!line.part_id && (
              <input
                className="field"
                placeholder="Describe it"
                value={line.description}
                onChange={(e) => setLine(index, { description: e.target.value })}
              />
            )}

            <input
              className="field"
              inputMode="decimal"
              placeholder="Price"
              value={line.unit_price}
              onChange={(e) => setLine(index, { unit_price: e.target.value })}
            />

            <input
              className="field"
              inputMode="numeric"
              value={line.quantity}
              onChange={(e) => setLine(index, { quantity: e.target.value })}
              aria-label="Quantity"
            />

            {lines.length > 1 && (
              <button
                type="button"
                className="btn-danger !px-3"
                onClick={() => setLines((prev) => prev.filter((_, i) => i !== index))}
              >
                Remove
              </button>
            )}
          </div>
        ))}

        <button
          type="button"
          className="btn-secondary"
          onClick={() => setLines((prev) => [...prev, { ...EMPTY_LINE }])}
        >
          Add another line
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Shipping">
          <input
            className="field"
            inputMode="decimal"
            value={form.shipping}
            onChange={(e) => setForm((p) => ({ ...p, shipping: e.target.value }))}
          />
        </Field>
        <Field label="Fees">
          <input
            className="field"
            inputMode="decimal"
            value={form.fees}
            onChange={(e) => setForm((p) => ({ ...p, fees: e.target.value }))}
          />
        </Field>
        <Field label="Tax">
          <input
            className="field"
            inputMode="decimal"
            value={form.tax}
            onChange={(e) => setForm((p) => ({ ...p, tax: e.target.value }))}
          />
        </Field>
      </div>

      <div className="flex items-center justify-between rounded-lg bg-slate-100 px-4 py-3">
        <span className="text-sm text-ink-soft">Cash actually collected</span>
        <span className="text-lg font-bold tabular-nums">{money(net)}</span>
      </div>

      <button type="submit" className="btn-primary w-full" disabled={create.isPending}>
        {create.isPending ? 'Saving…' : 'Record this sale'}
      </button>
    </form>
  )
}
