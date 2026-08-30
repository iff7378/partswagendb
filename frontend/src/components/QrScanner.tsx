import { BrowserQRCodeReader } from '@zxing/browser'
import { useEffect, useRef, useState } from 'react'

/**
 * Live QR scanner. Calls `onResult` once per detected code and then keeps
 * scanning, so the caller decides when to stop by unmounting.
 */
export default function QrScanner({
  onResult,
  paused = false,
}: {
  onResult: (text: string) => void
  paused?: boolean
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [failed, setFailed] = useState(false)

  // Held in a ref so restarting the camera does not depend on the callback's
  // identity, which changes on every parent render.
  const handler = useRef(onResult)
  handler.current = onResult

  const pausedRef = useRef(paused)
  pausedRef.current = paused

  useEffect(() => {
    const reader = new BrowserQRCodeReader()
    let controls: { stop: () => void } | undefined
    let stopped = false
    let last = ''
    let lastAt = 0

    async function start() {
      try {
        controls = await reader.decodeFromVideoDevice(undefined, videoRef.current!, (result) => {
          if (!result || stopped || pausedRef.current) return
          const text = result.getText()
          // The decoder fires continuously while a code is in frame; ignore
          // repeats of the same value within a couple of seconds.
          const now = Date.now()
          if (text === last && now - lastAt < 2000) return
          last = text
          lastAt = now
          handler.current(text)
        })
      } catch {
        setFailed(true)
      }
    }

    void start()

    return () => {
      stopped = true
      controls?.stop()
    }
  }, [])

  if (failed) {
    return (
      <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        Could not open the camera. Check permissions, or type the code instead. Browsers only
        allow camera access over HTTPS or on localhost.
      </p>
    )
  }

  return (
    <video
      ref={videoRef}
      className="aspect-square w-full rounded-lg bg-slate-900 object-cover"
      muted
      playsInline
    />
  )
}
