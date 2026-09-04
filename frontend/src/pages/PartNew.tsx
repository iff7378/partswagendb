import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import SuggestInput from '../components/SuggestInput'
import { ErrorNote, Field, PageHeader } from '../components/ui'
import { api } from '../lib/api'
import { CONDITION_LABELS } from '../lib/format'
import type { Category, Page, PartCondition, PartDetail, StorageLocation, Vehicle } from '../lib/types'

// The donor car and shelf stay put between saves: during a teardown you add
// twenty parts off one car into one bay, and re-picking each time is friction.
const STICKY_VEHICLE = 'pw.lastVehicle'
const STICKY_LOCATION = 'pw.lastLocation'
const STICKY_AGE_ALERT = 'pw.lastAgeAlert'

// Most parts are worth chasing after a couple of months.
const DEFAULT_AGE_ALERT_DAYS = '60'

interface Saved {
  id: number
  sku: string
  title: string
}

export default function PartNew() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const fileInput = useRef<HTMLInputElement>(null)

  const [vehicleId, setVehicleId] = useState(() => localStorage.getItem(STICKY_VEHICLE) ?? '')
  const [locationId, setLocationId] = useState(() => localStorage.getItem(STICKY_LOCATION) ?? '')
  const [title, setTitle] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [condition, setCondition] = useState<PartCondition>('b')
  const [price, setPrice] = useState('')
  const [partNumber, setPartNumber] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [notes, setNotes] = useState('')
  const [ageAlert, setAgeAlert] = useState(
    () => localStorage.getItem(STICKY_AGE_ALERT) ?? DEFAULT_AGE_ALERT_DAYS,
  )
  const [files, setFiles] = useState<File[]>([])
  const [previews, setPreviews] = useState<string[]>([])
  const [justSaved, setJustSaved] = useState<Saved | null>(null)

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

  useEffect(() => {
    const urls = files.map((file) => URL.createObjectURL(file))
    setPreviews(urls)
    return () => urls.forEach(URL.revokeObjectURL)
  }, [files])

  useEffect(() => {
    if (vehicleId) localStorage.setItem(STICKY_VEHICLE, vehicleId)
  }, [vehicleId])
  useEffect(() => {
    if (locationId) localStorage.setItem(STICKY_LOCATION, locationId)
  }, [locationId])
  useEffect(() => {
    localStorage.setItem(STICKY_AGE_ALERT, ageAlert)
  }, [ageAlert])

  const save = useMutation({
    mutationFn: async ({ andAnother }: { andAnother: boolean }) => {
      const part = await api.post<PartDetail>('/parts', {
        title: title.trim(),
        vehicle_id: vehicleId ? Number(vehicleId) : null,
        location_id: locationId ? Number(locationId) : null,
        category_id: categoryId ? Number(categoryId) : null,
        condition,
        quantity: Number(quantity) || 1,
        asking_price: price ? price : null,
        part_number: partNumber.trim() || null,
        notes: notes.trim() || null,
        age_alert_days: ageAlert ? Number(ageAlert) : null,
        // Anything with a price and a home is ready to sell; the rest stays a draft.
        status: price && locationId && categoryId ? 'available' : 'draft',
      })

      for (const file of files) {
        const form = new FormData()
        form.append('file', file)
        await api.upload(`/photos/parts/${part.id}`, form)
      }

      return { part, andAnother }
    },
    onSuccess: ({ part, andAnother }) => {
      void queryClient.invalidateQueries({ queryKey: ['parts'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })

      if (!andAnother) {
        navigate(`/parts/${part.id}`)
        return
      }

      setJustSaved({ id: part.id, sku: part.sku, title: part.title })
      setTitle('')
      setPrice('')
      setPartNumber('')
      setQuantity('1')
      setNotes('')
      setFiles([])
      if (fileInput.current) fileInput.current.value = ''
      window.scrollTo({ top: 0, behavior: 'smooth' })
    },
  })

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    save.mutate({ andAnother: false })
  }

  return (
    <>
      <PageHeader
        title="Add a part"
        subtitle="The car and shelf stay selected so you can work through a teardown"
      />

      {justSaved && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm">
          <span className="text-emerald-900">
            Saved <strong>{justSaved.title}</strong> as {justSaved.sku}
          </span>
          <Link to={`/parts/${justSaved.id}`} className="font-semibold text-emerald-800 underline">
            Open
          </Link>
        </div>
      )}

      <form onSubmit={onSubmit} className="space-y-4">
        <ErrorNote error={save.error} />

        <div className="card space-y-3 p-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
              Car and shelf
            </p>
            <p className="mt-1 text-sm text-ink-soft">
              These two stay selected after each save, so you can work through a whole car
              without picking them again.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Donor car">
              <select
                className="field"
                value={vehicleId}
                onChange={(e) => setVehicleId(e.target.value)}
              >
                <option value="">Not from a car</option>
                {vehicles.data?.items.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.display_name} ({v.stock_number})
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Where it is stored">
              <select
                className="field"
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
              >
                <option value="">Not put away yet</option>
                {locations.data?.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.path}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </div>

        <div className="card space-y-3 p-4">
          <Field label="Photos" hint="Part numbers get read automatically after upload.">
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              className="field"
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            />
          </Field>

          {previews.length > 0 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {previews.map((src) => (
                <img
                  key={src}
                  src={src}
                  alt=""
                  className="h-24 w-24 flex-none rounded-lg object-cover"
                />
              ))}
            </div>
          )}
        </div>

        <div className="card space-y-3 p-4">
          <Field
            label="What is it"
            hint="Pick a name you have used before so the same part is always called the same thing."
          >
            <SuggestInput
              field="part_title"
              className="field"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Alternator, front left fender…"
              required
              autoFocus
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Category">
              <select
                className="field"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
              >
                <option value="">Uncategorised</option>
                {categories.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.path}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Condition">
              <select
                className="field"
                value={condition}
                onChange={(e) => setCondition(e.target.value as PartCondition)}
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
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="85.00"
              />
            </Field>

            <Field label="Quantity">
              <input
                className="field"
                inputMode="numeric"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </Field>
          </div>

          <Field
            label="Flag it if unsold after"
            hint="It then shows up under 'Sitting too long' on the home page."
          >
            <select
              className="field"
              value={ageAlert}
              onChange={(e) => setAgeAlert(e.target.value)}
            >
              <option value="">Never</option>
              <option value="30">30 days</option>
              <option value="60">60 days</option>
              <option value="90">90 days</option>
              <option value="180">6 months</option>
            </select>
          </Field>

          <Field label="Part number" hint="Leave blank and let OCR fill it in from a photo.">
            <input
              className="field"
              value={partNumber}
              onChange={(e) => setPartNumber(e.target.value)}
            />
          </Field>

          <Field label="Notes">
            <textarea
              className="field"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Scuffed on one corner, tested working…"
            />
          </Field>
        </div>

        <div className="sticky bottom-16 flex gap-2 md:bottom-0">
          <button
            type="button"
            className="btn-secondary flex-1"
            disabled={save.isPending || !title.trim()}
            onClick={() => save.mutate({ andAnother: true })}
          >
            Save & add another
          </button>
          <button type="submit" className="btn-primary flex-1" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save & open'}
          </button>
        </div>
      </form>
    </>
  )
}
