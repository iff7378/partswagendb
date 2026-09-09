import { useEffect, useRef } from 'react'

import type { Photo } from '../lib/types'

/**
 * Full-size photo viewer.
 *
 * Part photos are the whole point of photographing a part -- casting numbers
 * and damage do not read at thumbnail size -- so they have to open.
 */
export default function Lightbox({
  photos,
  index,
  onIndex,
  onClose,
}: {
  photos: Photo[]
  index: number
  onIndex: (next: number) => void
  onClose: () => void
}) {
  const closeButton = useRef<HTMLButtonElement>(null)
  const photo = photos[index]

  useEffect(() => {
    // Escape to leave, arrows to move: what anyone tries first.
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
      if (event.key === 'ArrowRight' && index < photos.length - 1) onIndex(index + 1)
      if (event.key === 'ArrowLeft' && index > 0) onIndex(index - 1)
    }
    window.addEventListener('keydown', onKey)
    // Stop the page behind scrolling under the overlay on a phone.
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeButton.current?.focus()
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [index, photos.length, onIndex, onClose])

  if (!photo) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Photo ${index + 1} of ${photos.length}`}
      className="fixed inset-0 z-50 flex flex-col bg-black/90"
      // Clicking the backdrop closes; clicking the photo itself does not.
      onClick={onClose}
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3 text-white">
        <span className="text-sm">
          {index + 1} of {photos.length}
        </span>
        <div className="flex items-center gap-2">
          <a
            href={photo.url ?? undefined}
            target="_blank"
            rel="noreferrer noopener"
            className="rounded-lg bg-white/15 px-3 py-1.5 text-sm hover:bg-white/25"
            onClick={(e) => e.stopPropagation()}
          >
            Open original
          </a>
          <button
            ref={closeButton}
            type="button"
            className="rounded-lg bg-white/15 px-3 py-1.5 text-sm hover:bg-white/25"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center px-2 pb-4">
        <img
          src={photo.url ?? undefined}
          alt=""
          className="max-h-full max-w-full object-contain"
          onClick={(e) => e.stopPropagation()}
        />
      </div>

      {photos.length > 1 && (
        <div
          className="flex items-center justify-center gap-3 pb-6"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="rounded-lg bg-white/15 px-4 py-2 text-sm text-white disabled:opacity-40"
            disabled={index === 0}
            onClick={() => onIndex(index - 1)}
          >
            Previous
          </button>
          <button
            type="button"
            className="rounded-lg bg-white/15 px-4 py-2 text-sm text-white disabled:opacity-40"
            disabled={index === photos.length - 1}
            onClick={() => onIndex(index + 1)}
          >
            Next
          </button>
        </div>
      )}
    </div>
  )
}
