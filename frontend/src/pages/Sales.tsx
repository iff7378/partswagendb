import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { FormEvent } from 'react'

import SaleLines from '../components/SaleLines'
import SalesTabs from '../components/SalesTabs'
import { EMPTY_LINE, subtotalOf, toPayload, voidWarning } from '../lib/saleLines'
import type { Line } from '../lib/saleLines'
import { EmptyState, ErrorNote, Field, PageHeader, Spinner } from '../components/ui'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import {
  SALE_STATE_HINTS,
  SALE_STATE_LABELS,
  SALE_STATE_STYLES,
  date,
  dateTime,
  fromLocalInput,
  money,
  toLocalInput,
} from '../lib/format'
import type { Page, Sale, SaleChannel, SaleDetail, SaleState, User } from '../lib/types'

const STATE_FILTERS: { value: string; label: string }[] = [
  { value: '', label: 'Everything' },
  { value: 'pending', label: 'Agreed, nothing moved' },
  { value: 'paid', label: 'Paid, awaiting collection' },
  { value: 'gone', label: 'Gone, still owed for' },
  { value: 'complete', label: 'Done' },
]

function StateChip({ state }: { state: SaleState }) {
  return (
    <span
      className={`chip ring-1 ${SALE_STATE_STYLES[state]}`}
      title={SALE_STATE_HINTS[state]}
    >
      {SALE_STATE_LABELS[state]}
    </span>
  )
}

/** Turn a saved sale back into editable lines. */
function toLines(sale: SaleDetail): Line[] {
  return sale.items.map((item) => ({
    kind: item.is_shell ? 'shell' : item.parts.length > 0 ? 'parts' : 'other',
    partIds: item.parts.map((p) => p.id),
    vehicleId: item.vehicle_id ? String(item.vehicle_id) : '',
    description: item.description,
    unit_price: item.unit_price,
    quantity: String(item.quantity),
  }))
}

const CHANNELS: SaleChannel[] = ['local', 'ebay', 'facebook', 'phone', 'scrap', 'other']

const CHANNEL_LABELS: Record<SaleChannel, string> = {
  local: 'Local',
  ebay: 'eBay',
  facebook: 'Facebook',
  phone: 'Phone',
  scrap: 'Scrap yard',
  other: 'Other',
}

export default function Sales() {
  const { canEdit } = useAuth()
  const [adding, setAdding] = useState(false)
  const [state, setState] = useState('')
  // Arriving from the schedule opens that sale straight away.
  const [params] = useSearchParams()
  const openId = Number(params.get('open')) || null

  const sales = useQuery({
    queryKey: ['sales', state],
    queryFn: () =>
      api.get<Page<Sale>>(`/sales?limit=100${state ? `&state=${state}` : ''}`),
  })

  // What is agreed but not yet in the bank. Worth seeing without hunting.
  const owed = (sales.data?.items ?? [])
    .filter((sale) => sale.paid_on === null)
    .reduce((sum, sale) => sum + Number(sale.net_collected), 0)

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

      <SalesTabs />

      <div className="card mb-5 flex flex-wrap items-center gap-3 p-4">
        <label className="flex items-center gap-2 text-sm text-ink-soft">
          Showing
          <select
            className="field !w-auto !py-1.5 !text-sm"
            value={state}
            onChange={(e) => setState(e.target.value)}
          >
            {STATE_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        {owed > 0 && (
          <p className="ml-auto text-sm text-ink-soft">
            <strong className="text-amber-900">{money(owed)}</strong> agreed but not paid
          </p>
        )}
      </div>

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
          <SaleRow
            key={sale.id}
            sale={sale}
            canEdit={canEdit}
            startOpen={sale.id === openId}
          />
        ))}
      </div>
    </>
  )
}

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
  // Most sales are a walk-in paying cash and walking off with the part, so
  // that is the default; the other states are one click away.
  const [paid, setPaid] = useState(true)
  const [gone, setGone] = useState(true)
  const [meetup, setMeetup] = useState('')
  const [lines, setLines] = useState<Line[]>([{ ...EMPTY_LINE }])

  const users = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get<User[]>('/users'),
  })

  const create = useMutation({
    mutationFn: () =>
      api.post('/sales', {
        sold_on: form.sold_on,
        paid_on: paid ? form.sold_on : null,
        fulfilled_on: gone ? form.sold_on : null,
        meetup_at: gone ? null : fromLocalInput(meetup),
        channel: form.channel,
        buyer_name: form.buyer_name || null,
        collected_by_id: Number(form.collected_by_id),
        shipping: form.shipping || '0',
        fees: form.fees || '0',
        tax: form.tax || '0',
        items: toPayload(lines),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sales'] })
      void queryClient.invalidateQueries({ queryKey: ['parts'] })
      // Scrapping a shell moves the car to scrapped, so both car views are stale.
      void queryClient.invalidateQueries({ queryKey: ['vehicle'] })
      void queryClient.invalidateQueries({ queryKey: ['vehicles'] })
      void queryClient.invalidateQueries({ queryKey: ['vehicle-sales'] })
      void queryClient.invalidateQueries({ queryKey: ['schedule'] })
      void queryClient.invalidateQueries({ queryKey: ['settle-up'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      onDone()
    },
  })

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    create.mutate()
  }

  const subtotal = subtotalOf(lines)
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
                {CHANNEL_LABELS[c]}
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

      <SaleLines lines={lines} onChange={setLines} />

      <fieldset className="rounded-lg border border-slate-200 p-3">
        <legend className="px-1 text-sm font-semibold">Where has it got to?</legend>
        <label className="flex items-center gap-2 py-1 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-slate-300 text-rust focus:ring-rust"
            checked={paid}
            onChange={(e) => setPaid(e.target.checked)}
          />
          The money has landed
        </label>
        <label className="flex items-center gap-2 py-1 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-slate-300 text-rust focus:ring-rust"
            checked={gone}
            onChange={(e) => setGone(e.target.checked)}
          />
          The parts have been collected or shipped
        </label>
        {!gone && (
          <div className="mt-2">
            <Field
              label="When are they coming?"
              hint="Shows up on the pickup schedule. Leave blank if it is not arranged yet."
            >
              <input
                type="datetime-local"
                className="field"
                value={meetup}
                onChange={(e) => setMeetup(e.target.value)}
              />
            </Field>
          </div>
        )}

        <p className="mt-1 text-xs text-ink-soft">
          {paid && gone
            ? 'Done. The money counts today and the parts leave stock.'
            : paid
              ? 'Paid for. The parts stay on the shelf, held for this buyer.'
              : gone
                ? 'Gone but still owed for. It will not count as income until you mark it paid.'
                : 'Just agreed. The parts are held, and nothing hits the books yet.'}
        </p>
      </fieldset>

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

function SaleRow({
  sale,
  canEdit,
  startOpen = false,
}: {
  sale: Sale
  canEdit: boolean
  startOpen?: boolean
}) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(startOpen)
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
    // Voiding a scrap line puts the car back to stripped.
    void queryClient.invalidateQueries({ queryKey: ['vehicle'] })
    void queryClient.invalidateQueries({ queryKey: ['vehicles'] })
    void queryClient.invalidateQueries({ queryKey: ['vehicle-sales'] })
    void queryClient.invalidateQueries({ queryKey: ['schedule'] })
    void queryClient.invalidateQueries({ queryKey: ['settle-up'] })
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
  }

  // Marking paid or collected is a patch like any other, but it moves stock
  // and the ledger, so it refreshes everything a sale can touch.
  const advance = useMutation({
    mutationFn: (patch: Record<string, string>) => api.patch(`/sales/${sale.id}`, patch),
    onSuccess: refresh,
  })

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
          <p className="flex flex-wrap items-center gap-2 truncate text-sm font-medium">
            {sale.buyer_name || 'Walk-in buyer'}{' '}
            <span className="font-normal text-ink-soft">via {CHANNEL_LABELS[sale.channel]}</span>
            <StateChip state={sale.state} />
          </p>
          <p className="text-xs text-ink-soft">
            {sale.reference} · {date(sale.sold_on)} · collected by {sale.collected_by.full_name}
          </p>
          {sale.meetup_at && !sale.fulfilled_on && (
            <p className="text-xs font-medium text-rust">
              Pickup {dateTime(sale.meetup_at)}
            </p>
          )}
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
          <ErrorNote error={detail.error ?? voidSale.error ?? advance.error} />
          {detail.isLoading && <Spinner label="Loading the sale…" />}

          {detail.data && !editing && (
            <>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-slate-100">
                  {detail.data.items.map((item) => (
                    <tr key={item.id}>
                      <td className="py-1.5">
                        {item.parts.length === 1 && (
                          <span className="mr-2 font-mono text-xs text-ink-soft">
                            {item.parts[0].sku}
                          </span>
                        )}
                        {item.is_shell && (
                          <span className="mr-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-ink-soft">
                            Shell
                          </span>
                        )}
                        {item.description}
                        {item.parts.length > 1 && (
                          <span className="block text-xs text-ink-soft">
                            {item.parts.length} parts: {item.parts.map((p) => p.title).join(', ')}
                          </span>
                        )}
                        {item.parts.length === 0 && item.vehicle_name && !item.is_shell && (
                          <span className="block text-xs text-ink-soft">
                            off {item.vehicle_name}
                          </span>
                        )}
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
                  {!detail.data.paid_on && (
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={advance.isPending}
                      onClick={() =>
                        advance.mutate({ paid_on: new Date().toISOString().slice(0, 10) })
                      }
                    >
                      Mark paid
                    </button>
                  )}
                  {!detail.data.fulfilled_on && (
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={advance.isPending}
                      onClick={() =>
                        advance.mutate({
                          fulfilled_on: new Date().toISOString().slice(0, 10),
                        })
                      }
                    >
                      Mark collected
                    </button>
                  )}
                  <button type="button" className="btn-secondary" onClick={() => setEditing(true)}>
                    Edit
                  </button>
                  <button
                    type="button"
                    className="btn-danger ml-auto"
                    disabled={voidSale.isPending}
                    onClick={() => {
                      if (confirm(voidWarning(detail.data!))) {
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
    meetup_at: toLocalInput(sale.meetup_at),
  })
  const [lines, setLines] = useState<Line[]>(() => toLines(sale))

  const users = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get<User[]>('/users'),
  })

  // Parts already on this sale are marked sold, so they would otherwise be
  // missing from the picker and silently dropped on save.
  const keepPartIds = sale.items.flatMap((item) => item.parts.map((p) => p.id))

  const save = useMutation({
    mutationFn: () =>
      api.patch(`/sales/${sale.id}`, {
        sold_on: form.sold_on,
        meetup_at: fromLocalInput(form.meetup_at),
        channel: form.channel,
        buyer_name: form.buyer_name || null,
        collected_by_id: Number(form.collected_by_id),
        shipping: form.shipping || '0',
        fees: form.fees || '0',
        tax: form.tax || '0',
        items: toPayload(lines),
      }),
    onSuccess: onDone,
  })

  return (
    <div className="space-y-3 rounded-lg bg-slate-50 p-3">
      <ErrorNote error={save.error} />
      <p className="text-xs text-ink-soft">
        Changing what sold puts anything you take off back into stock, and takes anything you add
        out of it.
      </p>

      <SaleLines lines={lines} onChange={setLines} keepPartIds={keepPartIds} />

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
                {CHANNEL_LABELS[c]}
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

        <Field label="When they are coming" hint="Clear it to take this off the schedule.">
          <input
            type="datetime-local"
            className="field"
            value={form.meetup_at}
            onChange={(e) => setForm((p) => ({ ...p, meetup_at: e.target.value }))}
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
