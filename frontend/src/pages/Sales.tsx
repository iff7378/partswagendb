import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { FormEvent } from 'react'

import { EmptyState, ErrorNote, Field, PageHeader, Spinner } from '../components/ui'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { date, money } from '../lib/format'
import type { Page, Part, Sale, SaleChannel, SaleDetail, User } from '../lib/types'

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
          <SaleRow key={sale.id} sale={sale} canEdit={canEdit} />
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

function SaleRow({ sale, canEdit }: { sale: Sale; canEdit: boolean }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)

  // Line items only come back on the detail endpoint, so fetch on expand.
  const detail = useQuery({
    queryKey: ['sale', sale.id],
    queryFn: () => api.get<SaleDetail>(`/sales/${sale.id}`),
    enabled: open,
  })

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['sales'] })
    // Needed so an edit shows immediately. Harmless after a void, because the
    // query is disabled by then and a disabled query does not refetch.
    void queryClient.invalidateQueries({ queryKey: ['sale', sale.id] })
    void queryClient.invalidateQueries({ queryKey: ['parts'] })
    void queryClient.invalidateQueries({ queryKey: ['settle-up'] })
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
  }

  const voidSale = useMutation({
    mutationFn: () => api.delete(`/sales/${sale.id}`),
    onSuccess: () => {
      // Collapse first: leaving the row open would refetch a sale that no
      // longer exists and surface a 404.
      setOpen(false)
      queryClient.removeQueries({ queryKey: ['sale', sale.id] })
      refresh()
    },
  })

  return (
    <div className="px-4 py-3">
      <button
        type="button"
        className="flex w-full flex-wrap items-center gap-3 text-left"
        onClick={() => setOpen(!open)}
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {sale.buyer_name || 'Walk-in buyer'}{' '}
            <span className="font-normal text-ink-soft">via {sale.channel}</span>
          </p>
          <p className="text-xs text-ink-soft">
            {sale.reference} · {date(sale.sold_on)} · collected by {sale.collected_by.full_name}
          </p>
        </div>
        <div className="text-right">
          <p className="font-semibold tabular-nums">{money(sale.net_collected)}</p>
          {Number(sale.fees) > 0 && (
            <p className="text-xs text-ink-soft">after {money(sale.fees)} fees</p>
          )}
        </div>
        <span className="text-xs text-ink-soft">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
          <ErrorNote error={detail.error ?? voidSale.error} />
          {detail.isLoading && <Spinner label="Loading the sale…" />}

          {detail.data && !editing && (
            <>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-slate-100">
                  {detail.data.items.map((item) => (
                    <tr key={item.id}>
                      <td className="py-1.5">
                        {item.part_sku && (
                          <span className="mr-2 font-mono text-xs text-ink-soft">
                            {item.part_sku}
                          </span>
                        )}
                        {item.description}
                      </td>
                      <td className="py-1.5 text-right text-ink-soft">x{item.quantity}</td>
                      <td className="py-1.5 text-right tabular-nums">{money(item.line_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <dl className="space-y-1 text-sm">
                <Line label="Subtotal" value={detail.data.subtotal} />
                {Number(detail.data.shipping) > 0 && (
                  <Line label="Shipping" value={detail.data.shipping} />
                )}
                {Number(detail.data.tax) > 0 && <Line label="Tax" value={detail.data.tax} />}
                {Number(detail.data.fees) > 0 && (
                  <Line label="Fees" value={`-${detail.data.fees}`} />
                )}
                <div className="flex justify-between border-t border-slate-200 pt-1 font-semibold">
                  <dt>Collected</dt>
                  <dd className="tabular-nums">{money(detail.data.net_collected)}</dd>
                </div>
              </dl>

              {canEdit && (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setEditing(true)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="btn-danger ml-auto"
                    disabled={voidSale.isPending}
                    onClick={() => {
                      if (
                        confirm(
                          `Void ${sale.reference}? Its parts go back into stock and the ` +
                            `settle-up report changes.`,
                        )
                      ) {
                        voidSale.mutate()
                      }
                    }}
                  >
                    {voidSale.isPending ? 'Voiding…' : 'Void this sale'}
                  </button>
                </div>
              )}
            </>
          )}

          {detail.data && editing && (
            <EditSale
              sale={detail.data}
              onDone={() => {
                setEditing(false)
                refresh()
              }}
            />
          )}
        </div>
      )}
    </div>
  )
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-ink-soft">
      <dt>{label}</dt>
      <dd className="tabular-nums">{money(value)}</dd>
    </div>
  )
}

function EditSale({ sale, onDone }: { sale: SaleDetail; onDone: () => void }) {
  const [form, setForm] = useState({
    sold_on: sale.sold_on,
    channel: sale.channel,
    buyer_name: sale.buyer_name ?? '',
    collected_by_id: String(sale.collected_by_id),
    shipping: sale.shipping,
    fees: sale.fees,
    tax: sale.tax,
  })

  const users = useQuery({ queryKey: ['users'], queryFn: () => api.get<User[]>('/users') })

  const save = useMutation({
    mutationFn: () =>
      api.patch(`/sales/${sale.id}`, {
        sold_on: form.sold_on,
        channel: form.channel,
        buyer_name: form.buyer_name || null,
        collected_by_id: Number(form.collected_by_id),
        shipping: form.shipping || '0',
        fees: form.fees || '0',
        tax: form.tax || '0',
      }),
    onSuccess: onDone,
  })

  return (
    <div className="space-y-3 rounded-lg bg-slate-50 p-3">
      <ErrorNote error={save.error} />
      <p className="text-xs text-ink-soft">
        Line items cannot be changed here. To correct what sold, void the sale and record it again.
      </p>

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

        <Field label="Who took the money" hint="Changing this moves the settle-up balance.">
          <select
            className="field"
            value={form.collected_by_id}
            onChange={(e) => setForm((p) => ({ ...p, collected_by_id: e.target.value }))}
          >
            {users.data?.map((u) => (
              <option key={u.id} value={u.id}>
                {u.full_name}
              </option>
            ))}
          </select>
        </Field>

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

      <div className="flex gap-2">
        <button
          type="button"
          className="btn-primary"
          disabled={save.isPending}
          onClick={() => save.mutate()}
        >
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="btn-secondary" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  )
}
