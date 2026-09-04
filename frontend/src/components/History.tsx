import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { ErrorNote, Spinner } from './ui'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { dateTime } from '../lib/format'
import type { AuditEntry, Page } from '../lib/types'

const ACTIONS: Record<string, string> = {
  created: 'added',
  updated: 'changed',
  deleted: 'removed',
}

// Internals nobody needs to read, and fields whose change is already obvious
// from the one beside it.
const HIDE = new Set(['id', 'created_by_id', 'decoded_data', 'ocr_text', 'ocr_candidates'])

function label(field: string): string {
  const words = field.replace(/_id$/, '').replaceAll('_', ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function value(raw: unknown): string {
  if (raw === null || raw === undefined || raw === '') return 'nothing'
  if (typeof raw === 'boolean') return raw ? 'yes' : 'no'
  return String(raw)
}

/**
 * Who changed this, and what it said before.
 *
 * Shown to staff as well as admins: two people splitting takings need to be
 * able to check each other's working without asking permission first.
 */
export default function History({
  entity,
  entityId,
}: {
  entity: 'Sale' | 'Part' | 'Vehicle' | 'VehicleExpense' | 'Settlement'
  entityId: number
}) {
  const { canEdit } = useAuth()
  const [open, setOpen] = useState(false)

  const history = useQuery({
    queryKey: ['audit', entity, entityId],
    queryFn: () =>
      api.get<Page<AuditEntry>>(`/audit?entity=${entity}&entity_id=${entityId}&limit=100`),
    enabled: open,
  })

  // Viewers cannot read the trail, so offering it would only 403.
  if (!canEdit) return null

  return (
    <details
      className="card mt-4 px-4 py-3"
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className="cursor-pointer text-sm font-medium text-ink-soft">History</summary>

      {history.isLoading && <Spinner label="Reading the history…" />}
      <ErrorNote error={history.error} />

      {history.data?.items.length === 0 && (
        <p className="py-3 text-sm text-ink-soft">Nothing recorded since the audit trail began.</p>
      )}

      <ol className="mt-3 space-y-3">
        {history.data?.items.map((entry) => {
          const fields = Object.entries(entry.changes ?? {}).filter(([key]) => !HIDE.has(key))
          return (
            <li key={entry.id} className="border-l-2 border-slate-200 pl-3 text-sm">
              <p>
                <strong>{entry.user_name ?? 'Someone'}</strong> {ACTIONS[entry.action]} this
                <span className="text-ink-soft"> · {dateTime(entry.at)}</span>
              </p>
              {entry.action === 'updated' && fields.length > 0 && (
                <ul className="mt-1 space-y-0.5 text-xs text-ink-soft">
                  {fields.map(([field, change]) => {
                    const move = change as { from?: unknown; to?: unknown }
                    return (
                      <li key={field}>
                        {label(field)}: {value(move.from)} → <strong>{value(move.to)}</strong>
                      </li>
                    )
                  })}
                </ul>
              )}
            </li>
          )
        })}
      </ol>
    </details>
  )
}
