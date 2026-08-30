import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'

import QrScanner from '../components/QrScannerLazy'
import { ErrorNote, Field, PageHeader } from '../components/ui'
import { api, ApiError } from '../lib/api'
import type { PartDetail, StorageLocation } from '../lib/types'

/** Sends a scanned code to whichever record it belongs to. */
async function resolveCode(code: string): Promise<string> {
  const value = code.trim().toUpperCase()

  // Part SKUs are issued as P-000123; anything else is a location code.
  if (/^P-\d+$/.test(value)) {
    const part = await api.get<PartDetail>(`/parts/by-sku/${value}`)
    return `/parts/${part.id}`
  }

  const location = await api.get<StorageLocation>(`/locations/by-code/${value}`)
  return `/parts?location_id=${location.id}`
}

export default function Scan() {
  const navigate = useNavigate()
  const [error, setError] = useState<unknown>(null)
  const [manual, setManual] = useState('')
  const [busy, setBusy] = useState(false)

  async function go(code: string) {
    setError(null)
    setBusy(true)
    try {
      navigate(await resolveCode(code))
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 404
          ? new Error(`Nothing matches the code "${code}".`)
          : err,
      )
    } finally {
      setBusy(false)
    }
  }

  function onManualSubmit(event: FormEvent) {
    event.preventDefault()
    void go(manual)
  }

  return (
    <>
      <PageHeader title="Scan" subtitle="Point at a part or shelf label" />

      <div className="space-y-4">
        <ErrorNote error={error} />

        <div className="card space-y-2 p-3">
          <QrScanner paused={busy} onResult={(code) => void go(code)} />
          <p className="text-center text-sm text-ink-soft">
            {busy ? 'Looking it up…' : 'Looking for a QR code…'}
          </p>
        </div>

        <form onSubmit={onManualSubmit} className="card space-y-3 p-4">
          <Field label="Or type the code" hint="Like P-000123 or SHED-A-RACK-3.">
            <input
              className="field font-mono uppercase"
              value={manual}
              onChange={(e) => setManual(e.target.value.toUpperCase())}
              placeholder="P-000123"
            />
          </Field>
          <button type="submit" className="btn-primary w-full" disabled={!manual.trim() || busy}>
            Go
          </button>
        </form>
      </div>
    </>
  )
}
