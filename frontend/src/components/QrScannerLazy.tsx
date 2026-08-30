import { Suspense, lazy } from 'react'

// ZXing is ~400kB. Loading it only when a scanner actually mounts keeps it out
// of the initial bundle, which matters on a phone in a garage.
const QrScanner = lazy(() => import('./QrScanner'))

export default function QrScannerLazy(props: {
  onResult: (text: string) => void
  paused?: boolean
}) {
  return (
    <Suspense
      fallback={
        <div className="grid aspect-square w-full place-items-center rounded-lg bg-slate-900 text-sm text-white/70">
          Starting the camera…
        </div>
      }
    >
      <QrScanner {...props} />
    </Suspense>
  )
}
