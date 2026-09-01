import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'

import { EmptyState, ErrorNote, Field, PageHeader, Spinner } from '../components/ui'
import { api, ApiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { VEHICLE_STATUS_LABELS, VEHICLE_STATUS_STYLES, date } from '../lib/format'
import type { Page, Vehicle, VinDecodeResult } from '../lib/types'

export default function Vehicles() {
  const { canEdit } = useAuth()
  const [adding, setAdding] = useState(false)

  const vehicles = useQuery({
    queryKey: ['vehicles'],
    queryFn: () => api.get<Page<Vehicle>>('/vehicles?limit=100'),
  })

  return (
    <>
      <PageHeader
        title="Donor cars"
        subtitle={vehicles.data ? `${vehicles.data.total} on the books` : undefined}
        actions={
          canEdit && (
            <button type="button" className="btn-primary" onClick={() => setAdding(!adding)}>
              {adding ? 'Cancel' : 'Add a car'}
            </button>
          )
        }
      />

      {adding && <AddVehicleForm onDone={() => setAdding(false)} />}

      <ErrorNote error={vehicles.error} />
      {vehicles.isLoading && <Spinner />}

      {vehicles.data?.items.length === 0 && !adding && (
        <EmptyState
          title="No cars yet"
          hint="Add the first donor car and its VIN will fill in the year, make and model."
        />
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {vehicles.data?.items.map((v) => (
          <Link
            key={v.id}
            to={`/vehicles/${v.id}`}
            className="card p-4 transition hover:border-rust"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-semibold">{v.display_name}</p>
                <p className="truncate text-xs text-ink-soft">
                  {v.nickname && v.description ? `${v.description} · ` : ''}
                  {v.stock_number}
                </p>
              </div>
              <span className={`chip ${VEHICLE_STATUS_STYLES[v.status]}`}>
                {VEHICLE_STATUS_LABELS[v.status]}
              </span>
            </div>
            <dl className="mt-3 space-y-1 text-xs text-ink-soft">
              {(v.vin || v.vin_unknown) && (
                <div className="flex justify-between gap-2">
                  <dt>VIN</dt>
                  <dd className={v.vin ? 'truncate font-mono' : 'italic'}>
                    {v.vin ?? 'unknown'}
                  </dd>
                </div>
              )}
              {v.engine && (
                <div className="flex justify-between gap-2">
                  <dt>Engine</dt>
                  <dd className="truncate">{v.engine}</dd>
                </div>
              )}
              <div className="flex justify-between gap-2">
                <dt>Acquired</dt>
                <dd>{date(v.acquired_on)}</dd>
              </div>
            </dl>
          </Link>
        ))}
      </div>
    </>
  )
}

function AddVehicleForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient()
  const [vin, setVin] = useState('')
  const [vinUnknown, setVinUnknown] = useState(false)
  const [decoded, setDecoded] = useState<VinDecodeResult | null>(null)
  const [decodeNote, setDecodeNote] = useState<string | null>(null)
  const [form, setForm] = useState({
    nickname: '',
    year: '',
    make: '',
    model: '',
    trim: '',
    engine: '',
    acquired_on: '',
    acquired_from: '',
    notes: '',
  })

  const decode = useMutation({
    mutationFn: (value: string) => api.get<VinDecodeResult>(`/vehicles/decode/${value}`),
    onSuccess: (result) => {
      setDecoded(result)
      setDecodeNote(null)
      setForm((prev) => ({
        ...prev,
        year: result.year ? String(result.year) : prev.year,
        make: result.make ?? prev.make,
        model: result.model ?? prev.model,
        trim: result.trim ?? prev.trim,
        engine: result.engine ?? prev.engine,
      }))
    },
    onError: (error) => {
      setDecoded(null)
      setDecodeNote(
        error instanceof ApiError && error.status === 400
          ? error.message
          : 'Could not reach the VIN service. Fill the details in by hand.',
      )
    },
  })

  const create = useMutation({
    mutationFn: () =>
      api.post<Vehicle>('/vehicles', {
        vin: vinUnknown ? null : vin.trim() || null,
        vin_unknown: vinUnknown,
        nickname: form.nickname.trim() || null,
        year: form.year ? Number(form.year) : null,
        make: form.make || null,
        model: form.model || null,
        trim: form.trim || null,
        engine: form.engine || null,
        acquired_on: form.acquired_on || null,
        acquired_from: form.acquired_from || null,
        notes: form.notes || null,
        decode_vin: !decoded && !vinUnknown,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['vehicles'] })
      onDone()
    },
  })

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    create.mutate()
  }

  return (
    <form onSubmit={onSubmit} className="card mb-5 space-y-3 p-4">
      <ErrorNote error={create.error} />

      <Field
        label="What you'll call it"
        hint="Used everywhere else in the app. Leave blank to use the year, make and model."
      >
        <input
          className="field"
          value={form.nickname}
          onChange={(e) => set('nickname', e.target.value)}
          placeholder="The silver wagon"
        />
      </Field>

      <Field label="VIN" hint="17 characters. Decoding fills in the rest.">
        <div className="flex gap-2">
          <input
            className="field font-mono uppercase"
            value={vinUnknown ? '' : vin}
            onChange={(e) => setVin(e.target.value.toUpperCase())}
            maxLength={17}
            placeholder="3VWFE21C04M000001"
            disabled={vinUnknown}
          />
          <button
            type="button"
            className="btn-secondary"
            disabled={vinUnknown || vin.trim().length !== 17 || decode.isPending}
            onClick={() => decode.mutate(vin.trim())}
          >
            {decode.isPending ? 'Looking…' : 'Decode'}
          </button>
        </div>
      </Field>

      <label className="flex items-center gap-2 text-sm text-ink-soft">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-slate-300 text-rust focus:ring-rust"
          checked={vinUnknown}
          onChange={(e) => setVinUnknown(e.target.checked)}
        />
        VIN is unknown — plate missing or unreadable
      </label>

      {decoded && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          Found a {[decoded.year, decoded.make, decoded.model, decoded.trim]
            .filter(Boolean)
            .join(' ')}
          {decoded.engine ? ` with a ${decoded.engine}` : ''}.
        </p>
      )}
      {decodeNote && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{decodeNote}</p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Year">
          <input
            className="field"
            inputMode="numeric"
            value={form.year}
            onChange={(e) => set('year', e.target.value)}
          />
        </Field>
        <Field label="Make">
          <input className="field" value={form.make} onChange={(e) => set('make', e.target.value)} />
        </Field>
        <Field label="Model">
          <input
            className="field"
            value={form.model}
            onChange={(e) => set('model', e.target.value)}
          />
        </Field>
        <Field label="Trim">
          <input className="field" value={form.trim} onChange={(e) => set('trim', e.target.value)} />
        </Field>
        <Field label="Engine">
          <input
            className="field"
            value={form.engine}
            onChange={(e) => set('engine', e.target.value)}
          />
        </Field>
        <Field label="Acquired on">
          <input
            type="date"
            className="field"
            value={form.acquired_on}
            onChange={(e) => set('acquired_on', e.target.value)}
          />
        </Field>
      </div>

      <Field label="Bought from">
        <input
          className="field"
          value={form.acquired_from}
          onChange={(e) => set('acquired_from', e.target.value)}
          placeholder="Copart lot 123, neighbour, auction…"
        />
      </Field>

      <button type="submit" className="btn-primary w-full" disabled={create.isPending}>
        {create.isPending ? 'Saving…' : 'Add this car'}
      </button>
    </form>
  )
}
