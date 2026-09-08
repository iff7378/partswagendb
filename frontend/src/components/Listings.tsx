import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { FormEvent } from 'react'

import SuggestInput from './SuggestInput'
import { ErrorNote, Field } from './ui'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { LISTING_CHANNEL_LABELS, date } from '../lib/format'
import type { ListingChannel, PartListing } from '../lib/types'

const CHANNELS: ListingChannel[] = ['facebook', 'ebay', 'craigslist', 'offerup', 'other']

/**
 * Where a part is advertised, under which account, and the link to it.
 *
 * Several at once on purpose: the same part gets cross-posted, and when it
 * sells every one of them needs taking down. Taking one down keeps the row —
 * where something was advertised is worth remembering.
 */
export default function Listings({
  partId,
  listings,
}: {
  partId: number
  listings: PartListing[]
}) {
  const { canEdit } = useAuth()
  const queryClient = useQueryClient()
  const [adding, setAdding] = useState(false)

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['part', String(partId)] })
    void queryClient.invalidateQueries({ queryKey: ['stale-listings'] })
    void queryClient.invalidateQueries({ queryKey: ['suggestions', 'listing_account'] })
  }

  const live = listings.filter((l) => l.is_live)
  const closed = listings.filter((l) => !l.is_live)

  return (
    <section className="card mt-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-soft">
            Where it&rsquo;s listed
          </h2>
          <p className="text-sm text-ink-soft">
            {live.length === 0
              ? 'Not advertised anywhere yet.'
              : `Live in ${live.length} ${live.length === 1 ? 'place' : 'places'}.`}
          </p>
        </div>
        {canEdit && (
          <button type="button" className="btn-secondary" onClick={() => setAdding(!adding)}>
            {adding ? 'Cancel' : 'Add a listing'}
          </button>
        )}
      </div>

      {adding && <AddListing partId={partId} onDone={() => { setAdding(false); refresh() }} />}

      <ul className="divide-y divide-slate-100">
        {[...live, ...closed].map((listing) => (
          <Row key={listing.id} listing={listing} canEdit={canEdit} onChange={refresh} />
        ))}
      </ul>
    </section>
  )
}

function Row({
  listing,
  canEdit,
  onChange,
}: {
  listing: PartListing
  canEdit: boolean
  onChange: () => void
}) {
  const close = useMutation({
    mutationFn: (removed_on: string | null) =>
      api.patch(`/parts/listings/${listing.id}`, { removed_on }),
    onSuccess: onChange,
  })
  const remove = useMutation({
    mutationFn: () => api.delete(`/parts/listings/${listing.id}`),
    onSuccess: onChange,
  })

  return (
    <li className={`px-4 py-3 ${listing.is_live ? '' : 'opacity-60'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {LISTING_CHANNEL_LABELS[listing.channel]}
            {listing.account && (
              <span className="font-normal text-ink-soft"> · {listing.account}</span>
            )}
          </p>
          <p className="text-xs text-ink-soft">
            Posted {date(listing.posted_on)}
            {listing.removed_on && ` · taken down ${date(listing.removed_on)}`}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {listing.url && (
            <a
              href={listing.url}
              target="_blank"
              rel="noreferrer noopener"
              className="btn-secondary !px-3 !py-1.5 !text-xs"
            >
              Open
            </a>
          )}
          {canEdit && listing.is_live && (
            <button
              type="button"
              className="btn-secondary !px-3 !py-1.5 !text-xs"
              disabled={close.isPending}
              onClick={() => close.mutate(new Date().toISOString().slice(0, 10))}
            >
              Taken down
            </button>
          )}
          {canEdit && !listing.is_live && (
            <button
              type="button"
              className="btn-secondary !px-3 !py-1.5 !text-xs"
              onClick={() => close.mutate(null)}
            >
              Relist
            </button>
          )}
          {canEdit && (
            <button
              type="button"
              className="btn-danger !px-2 !py-1 !text-xs"
              onClick={() => {
                if (confirm('Delete this listing record? Use "Taken down" if the advert just ended.')) {
                  remove.mutate()
                }
              }}
            >
              Delete
            </button>
          )}
        </div>
      </div>
      <ErrorNote error={close.error ?? remove.error} />
    </li>
  )
}

function AddListing({ partId, onDone }: { partId: number; onDone: () => void }) {
  const [form, setForm] = useState({
    channel: 'facebook' as ListingChannel,
    account: '',
    url: '',
  })

  const create = useMutation({
    mutationFn: () =>
      api.post(`/parts/${partId}/listings`, {
        channel: form.channel,
        account: form.account.trim() || null,
        url: form.url.trim() || null,
      }),
    onSuccess: onDone,
  })

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    create.mutate()
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 border-b border-slate-100 bg-slate-50 p-4">
      <ErrorNote error={create.error} />

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Where">
          <select
            className="field"
            value={form.channel}
            onChange={(e) => setForm((p) => ({ ...p, channel: e.target.value as ListingChannel }))}
          >
            {CHANNELS.map((c) => (
              <option key={c} value={c}>
                {LISTING_CHANNEL_LABELS[c]}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Which account" hint="Suggests accounts you have posted under before.">
          <SuggestInput
            field="listing_account"
            className="field"
            value={form.account}
            onChange={(e) => setForm((p) => ({ ...p, account: e.target.value }))}
            placeholder="BigGayDiesel"
          />
        </Field>
      </div>

      <Field label="Link to the listing">
        <input
          className="field"
          type="url"
          inputMode="url"
          value={form.url}
          onChange={(e) => setForm((p) => ({ ...p, url: e.target.value }))}
          placeholder="https://www.facebook.com/marketplace/item/…"
        />
      </Field>

      <div className="flex gap-2">
        <button type="button" className="btn-secondary flex-1" onClick={onDone}>
          Cancel
        </button>
        <button type="submit" className="btn-primary flex-1" disabled={create.isPending}>
          {create.isPending ? 'Saving…' : 'Add it'}
        </button>
      </div>
    </form>
  )
}
