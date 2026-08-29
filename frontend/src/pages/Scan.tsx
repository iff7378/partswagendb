import { BrowserQRCodeReader } from '@zxing/browser'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

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
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<unknown>(null)
  const [manual, setManual] = useState('')
  const [scanning, setScanning] = useState(false)

  useEffect(() => {
    const reader = new BrowserQRCodeReader()
    let stopped = false
    let controls: { stop: () => void } | undefined

    async function start() {
      try {
        setScanning(true)
        controls = await reader.decodeFromVideoDevice(
          undefined,
          videoRef.current!,
          (result) => {
            if (!result || stopped) return
            stopped = true
            controls?.stop()
            void go(result.getText())
          },
        )
      } catch {
        setScanning(false)
        setError(
          new Error(
            'Could not open the camera. Check permissions, or type the code in below. ' +
              'Note that browsers only allow the camera over HTTPS or on localhost.',
          ),
        )
      }
    }

    async function go(code: string) {
      try {
        navigate(await resolveCode(code))
      } catch (err) {
        stopped = false
        setError(
          err instanceof ApiError && err.status === 404
            ? new Error(`Nothing matches the code "${code}".`)
            : err,
        )
        void start()
      }
    }

    void start()

    return () => {
      stopped = true
      controls?.stop()
    }
  }, [navigate])

  async function onManualSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    try {
      navigate(await resolveCode(manual))
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 404
          ? new Error(`Nothing matches the code "${manual}".`)
          : err,
      )
    }
  }

  return (
    <>
      <PageHeader title="Scan" subtitle="Point at a part or shelf label" />

      <div className="space-y-4">
        <ErrorNote error={error} />

        <div className="card overflow-hidden">
          <video
            ref={videoRef}
            className="aspect-square w-full bg-slate-900 object-cover"
            muted
            playsInline
          />
          <p className="px-4 py-3 text-center text-sm text-ink-soft">
            {scanning ? 'Looking for a QR code…' : 'Camera unavailable'}
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
          <button type="submit" className="btn-primary w-full" disabled={!manual.trim()}>
            Go
          </button>
        </form>
      </div>
    </>
  )
}
