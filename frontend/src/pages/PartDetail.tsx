import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import QrScanner from '../components/QrScannerLazy'
import { ErrorNote, Field, PageHeader, Spinner, StatusChip } from '../components/ui'
import { api, download } from '../lib/api'
import { CONDITION_LABELS, STATUS_LABELS, date, humanAge, money } from '../lib/format'
import { useAuth } from '../lib/auth'
import type {
  Category,
  PartCondition,
  PartDetail,
  PartStatus,
  StorageLocation,
  Vehicle,
  Page,
} from '../lib/types'

export default function PartDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { canEdit } = useAuth()
  const [editing, setEditing] = useState(false)

  const part = useQuery({
    queryKey: ['part', id],
    queryFn: () => api.get<PartDetail>(`/parts/${id}`),
    // OCR runs in the background after upload, so keep checking until it lands.
    refetchInterval: (query) =>
      query.state.data?.photos.some((p) => p.ocr_status === 'pending') ? 3000 : false,
  })

  const uploadPhoto = useMutation({
    mutationFn: async (files: FileList) => {
      for (const file of Array.from(files)) {
        const form = new FormData()
        form.append('file', file)
        await api.upload(`/photos/parts/${id}`, form)
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['part', id] }),
  })

  const deletePhoto = useMutation({
    mutationFn: (photoId: number) => api.delete(`/photos/${photoId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['part', id] }),
  })

  const reprocess = useMutation({
    mutationFn: (photoId: number) => api.post(`/photos/${photoId}/reprocess`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['part', id] }),
  })

  const setPrimary = useMutation({
    mutationFn: (photoId: number) => api.post(`/photos/${photoId}/primary`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['part', id] }),
  })

  const update = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.patch(`/parts/${id}`, payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['part', id] })
      void queryClient.invalidateQueries({ queryKey: ['parts'] })
      setEditing(false)
    },
  })

  const remove = useMutation({
    mutationFn: () => api.delete(`/parts/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['parts'] })
      navigate('/parts')
    },
  })

  if (part.isLoading) return <Spinner />
  if (part.error) return <ErrorNote error={part.error} />

  const p = part.data!
  const suggestions = p.photos.flatMap((photo) => photo.ocr_candidates ?? [])
  const awaitingOcr = p.photos.some((photo) => photo.ocr_status === 'pending')

  return (
    <>
      <PageHeader
        title={p.title}
        subtitle={`${p.sku} · added ${date(p.created_at)}`}
        actions={
          canEdit && (
            <>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => void download(`/labels/parts?ids=${p.id}`, `${p.sku}.pdf`)}
              >
                Print label
              </button>
              {/* Only for stock that could still be sold: anything already on
                  a sale is handled by editing that sale, not by starting
                  another one that would be rejected. */}
              {['draft', 'available', 'reserved'].includes(p.status) && (
                <Link to={`/sales?parts=${p.id}`} className="btn-primary">
                  Sell this
                </Link>
              )}
              <button type="button" className="btn-secondary" onClick={() => setEditing(!editing)}>
                {editing ? 'Cancel' : 'Edit'}
              </button>
            </>
          )
        }
      />

      <ErrorNote error={update.error ?? remove.error ?? uploadPhoto.error} />

      {canEdit && <MovePart part={p} />}

      {editing ? (
        <EditForm part={p} onSave={(payload) => update.mutate(payload)} saving={update.isPending} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
          <section className="space-y-3">
            {p.photos.length > 0 ? (
              <div className="grid grid-cols-2 gap-2">
                {p.photos.map((photo) => (
                  <figure key={photo.id} className="card group relative overflow-hidden">
                    <img
                      src={photo.url ?? undefined}
                      alt=""
                      className="aspect-square w-full object-cover"
                    />
                    {photo.is_primary && (
                      <span className="absolute left-2 top-2 chip bg-white/95 text-ink ring-slate-200">
                        Main
                      </span>
                    )}
                    {canEdit && (
                      <figcaption className="flex gap-1 p-2">
                        {!photo.is_primary && (
                          <button
                            type="button"
                            className="btn-secondary flex-1 !px-2 !py-1 !text-xs"
                            onClick={() => setPrimary.mutate(photo.id)}
                          >
                            Make main
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn-danger !px-2 !py-1 !text-xs"
                          onClick={() => deletePhoto.mutate(photo.id)}
                        >
                          Delete
                        </button>
                      </figcaption>
                    )}
                  </figure>
                ))}
              </div>
            ) : (
              <div className="card grid place-items-center py-14 text-sm text-ink-soft">
                No photos yet
              </div>
            )}

            {canEdit && (
              <input
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                className="field"
                onChange={(e) => e.target.files && uploadPhoto.mutate(e.target.files)}
              />
            )}

            {awaitingOcr && (
              <p className="text-sm text-ink-soft">Reading part numbers from the photos…</p>
            )}

            {canEdit && !awaitingOcr && p.photos.length > 0 && suggestions.length === 0 && (
              <div className="card flex flex-wrap items-center gap-3 p-4">
                <p className="text-sm text-ink-soft">
                  No part numbers found in these photos.
                </p>
                <button
                  type="button"
                  className="btn-secondary ml-auto"
                  disabled={reprocess.isPending}
                  onClick={() => p.photos.forEach((photo) => reprocess.mutate(photo.id))}
                >
                  {reprocess.isPending ? 'Reading…' : 'Try reading again'}
                </button>
              </div>
            )}

            {suggestions.length > 0 && !p.part_number && canEdit && (
              <div className="card p-4">
                <p className="mb-2 text-sm font-semibold">Part numbers spotted in the photos</p>
                <div className="flex flex-wrap gap-2">
                  {suggestions.slice(0, 6).map((candidate) => (
                    <button
                      key={candidate.value}
                      type="button"
                      className="btn-secondary !px-3 !py-1.5 !text-xs font-mono"
                      onClick={() => update.mutate({ part_number: candidate.value })}
                    >
                      {candidate.value}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-xs text-ink-soft">Tap one to set it as the part number.</p>
              </div>
            )}
          </section>

          <section className="card divide-y divide-slate-100">
            <Row label="Status">
              <StatusChip status={p.status} />
            </Row>
            <Row label="Asking price">
              <span className="font-bold">{money(p.asking_price)}</span>
            </Row>
            <Row label="Condition">{CONDITION_LABELS[p.condition]}</Row>
            <Row label="Quantity">{p.quantity}</Row>
            <Row label="In stock for">
              <span className={p.is_overdue ? 'font-semibold text-rose-700' : undefined}>
                {humanAge(p.days_in_stock)}
                {p.age_alert_days ? ` · flags at ${p.age_alert_days}d` : ''}
              </span>
            </Row>
            <Row label="Stored at">{p.location?.path ?? 'Not put away'}</Row>
            <Row label="Category">{p.category?.path ?? '—'}</Row>
            <Row label="Donor car">
              {p.vehicle ? (
                <Link to={`/vehicles/${p.vehicle.id}`} className="font-medium text-rust">
                  {p.vehicle.display_name}
                </Link>
              ) : (
                '—'
              )}
            </Row>
            <Row label="Part number">
              <span className="font-mono text-sm">{p.part_number ?? '—'}</span>
            </Row>
            <Row label="OEM number">
              <span className="font-mono text-sm">{p.oem_number ?? '—'}</span>
            </Row>
            <Row label="Manufacturer">{p.manufacturer ?? '—'}</Row>
            <Row label="Tags">
              {p.tags.length ? (
                <span className="flex flex-wrap justify-end gap-1">
                  {p.tags.map((tag) => (
                    <span key={tag.id} className="chip bg-slate-100 text-ink-soft ring-slate-200">
                      {tag.name}
                    </span>
                  ))}
                </span>
              ) : (
                '—'
              )}
            </Row>
            {p.description && <Row label="Description">{p.description}</Row>}
            {p.notes && <Row label="Notes">{p.notes}</Row>}

            {canEdit && (
              <div className="p-4">
                <button
                  type="button"
                  className="btn-danger w-full"
                  onClick={() => {
                    if (confirm(`Delete ${p.sku}? This cannot be undone.`)) remove.mutate()
                  }}
                >
                  Delete this part
                </button>
              </div>
            )}
          </section>
        </div>
      )}
    </>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3">
      <span className="text-sm text-ink-soft">{label}</span>
      <span className="text-right text-sm">{children}</span>
    </div>
  )
}

function EditForm({
  part,
  onSave,
  saving,
}: {
  part: PartDetail
  onSave: (payload: Record<string, unknown>) => void
  saving: boolean
}) {
  const [form, setForm] = useState({
    title: part.title,
    description: part.description ?? '',
    part_number: part.part_number ?? '',
    oem_number: part.oem_number ?? '',
    manufacturer: part.manufacturer ?? '',
    condition: part.condition,
    status: part.status,
    quantity: String(part.quantity),
    asking_price: part.asking_price ?? '',
    notes: part.notes ?? '',
    age_alert_days: part.age_alert_days ? String(part.age_alert_days) : '',
    vehicle_id: part.vehicle_id ? String(part.vehicle_id) : '',
    category_id: part.category_id ? String(part.category_id) : '',
    location_id: part.location_id ? String(part.location_id) : '',
    tags: part.tags.map((t) => t.name).join(', '),
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

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  return (
    <form
      className="card space-y-3 p-4"
      onSubmit={(e) => {
        e.preventDefault()
        onSave({
          ...form,
          quantity: Number(form.quantity) || 1,
          asking_price: form.asking_price || null,
          description: form.description || null,
          part_number: form.part_number || null,
          oem_number: form.oem_number || null,
          manufacturer: form.manufacturer || null,
          notes: form.notes || null,
          age_alert_days: form.age_alert_days ? Number(form.age_alert_days) : null,
          vehicle_id: form.vehicle_id ? Number(form.vehicle_id) : null,
          category_id: form.category_id ? Number(form.category_id) : null,
          location_id: form.location_id ? Number(form.location_id) : null,
          tags: form.tags
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean),
        })
      }}
    >
      <Field label="Title">
        <input className="field" value={form.title} onChange={(e) => set('title', e.target.value)} />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Status">
          <select
            className="field"
            value={form.status}
            onChange={(e) => set('status', e.target.value as PartStatus)}
          >
            {Object.entries(STATUS_LABELS)
              // Sold is what being on a sale means, not a label you apply.
              // Offering it here let parts leave stock with no money recorded.
              .filter(([value]) => value !== 'sold' || part.status === 'sold')
              .map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
          </select>
        </Field>

        <Field label="Condition">
          <select
            className="field"
            value={form.condition}
            onChange={(e) => set('condition', e.target.value as PartCondition)}
          >
            {Object.entries(CONDITION_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Asking price">
          <input
            className="field"
            inputMode="decimal"
            value={form.asking_price}
            onChange={(e) => set('asking_price', e.target.value)}
          />
        </Field>

        <Field label="Quantity">
          <input
            className="field"
            inputMode="numeric"
            value={form.quantity}
            onChange={(e) => set('quantity', e.target.value)}
          />
        </Field>

        <Field label="Donor car">
          <select
            className="field"
            value={form.vehicle_id}
            onChange={(e) => set('vehicle_id', e.target.value)}
          >
            <option value="">None</option>
            {vehicles.data?.items.map((v) => (
              <option key={v.id} value={v.id}>
                {v.display_name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Stored at">
          <select
            className="field"
            value={form.location_id}
            onChange={(e) => set('location_id', e.target.value)}
          >
            <option value="">Not put away</option>
            {locations.data?.map((l) => (
              <option key={l.id} value={l.id}>
                {l.path}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Category">
          <select
            className="field"
            value={form.category_id}
            onChange={(e) => set('category_id', e.target.value)}
          >
            <option value="">Uncategorised</option>
            {categories.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.path}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Manufacturer">
          <input
            className="field"
            value={form.manufacturer}
            onChange={(e) => set('manufacturer', e.target.value)}
          />
        </Field>

        <Field label="Part number">
          <input
            className="field font-mono"
            value={form.part_number}
            onChange={(e) => set('part_number', e.target.value)}
          />
        </Field>

        <Field label="OEM number">
          <input
            className="field font-mono"
            value={form.oem_number}
            onChange={(e) => set('oem_number', e.target.value)}
          />
        </Field>

        <Field
          label="Flag it if unsold after"
          hint="It then shows up under 'Sitting too long' on the home page."
        >
          <select
            className="field"
            value={form.age_alert_days}
            onChange={(e) => set('age_alert_days', e.target.value)}
          >
            <option value="">Never</option>
            <option value="30">30 days</option>
            <option value="60">60 days</option>
            <option value="90">90 days</option>
            <option value="180">6 months</option>
            <option value="365">1 year</option>
          </select>
        </Field>
      </div>

      <Field label="Tags" hint="Comma separated.">
        <input className="field" value={form.tags} onChange={(e) => set('tags', e.target.value)} />
      </Field>

      <Field label="Description">
        <textarea
          className="field"
          rows={3}
          value={form.description}
          onChange={(e) => set('description', e.target.value)}
        />
      </Field>

      <Field label="Notes">
        <textarea
          className="field"
          rows={2}
          value={form.notes}
          onChange={(e) => set('notes', e.target.value)}
        />
      </Field>

      <button type="submit" className="btn-primary w-full" disabled={saving}>
        {saving ? 'Saving…' : 'Save changes'}
      </button>
    </form>
  )
}

function MovePart({ part }: { part: PartDetail }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [moved, setMoved] = useState<string | null>(null)

  const locations = useQuery({
    queryKey: ['locations'],
    queryFn: () => api.get<StorageLocation[]>('/locations'),
  })

  const move = useMutation({
    mutationFn: (body: { location_id?: number | null; location_code?: string }) =>
      api.post<PartDetail>(`/parts/${part.id}/move`, body),
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: ['part', String(part.id)] })
      void queryClient.invalidateQueries({ queryKey: ['parts'] })
      void queryClient.invalidateQueries({ queryKey: ['locations'] })
      setMoved(updated.location?.path ?? 'Nowhere')
      setScanning(false)
    },
  })

  if (!open) {
    return (
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3">
        <span className="text-sm text-ink-soft">
          Stored at <strong className="text-ink">{part.location?.path ?? 'nowhere yet'}</strong>
        </span>
        <button type="button" className="btn-secondary ml-auto" onClick={() => setOpen(true)}>
          Move it
        </button>
      </div>
    )
  }

  return (
    <div className="mb-4 space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <ErrorNote error={move.error} />
      {moved && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          Moved to <strong>{moved}</strong>.
        </p>
      )}

      {scanning ? (
        <>
          <p className="text-sm text-ink-soft">Point the camera at a shelf label.</p>
          <QrScanner
            paused={move.isPending}
            onResult={(code) => move.mutate({ location_code: code.trim().toUpperCase() })}
          />
          <button type="button" className="btn-secondary w-full" onClick={() => setScanning(false)}>
            Stop scanning
          </button>
        </>
      ) : (
        <>
          <Field label="Move to">
            <select
              className="field"
              defaultValue={part.location_id ? String(part.location_id) : ''}
              onChange={(e) =>
                move.mutate(
                  e.target.value ? { location_id: Number(e.target.value) } : { location_id: null },
                )
              }
            >
              <option value="">Nowhere</option>
              {locations.data?.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.path}
                </option>
              ))}
            </select>
          </Field>

          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary" onClick={() => setScanning(true)}>
              Scan a shelf label
            </button>
            <button
              type="button"
              className="btn-secondary ml-auto"
              onClick={() => {
                setOpen(false)
                setMoved(null)
              }}
            >
              Done
            </button>
          </div>
        </>
      )}
    </div>
  )
}
