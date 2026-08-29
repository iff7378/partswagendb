import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'

import { EmptyState, ErrorNote, Field, PageHeader, Spinner } from '../components/ui'
import { api, download } from '../lib/api'
import { useAuth } from '../lib/auth'
import type { LocationKind, LocationNode, StorageLocation } from '../lib/types'

const KINDS: LocationKind[] = ['site', 'shelf', 'bay', 'bin']

export default function Locations() {
  const { canEdit } = useAuth()
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<number[]>([])

  const tree = useQuery({
    queryKey: ['locations', 'tree'],
    queryFn: () => api.get<LocationNode[]>('/locations/tree'),
  })
  const flat = useQuery({
    queryKey: ['locations'],
    queryFn: () => api.get<StorageLocation[]>('/locations'),
  })

  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/locations/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['locations'] })
    },
  })

  function toggle(id: number) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  return (
    <>
      <PageHeader
        title="Storage"
        subtitle="Sites, shelves, bays and bins — each one gets a QR label"
        actions={
          selected.length > 0 && (
            <button
              type="button"
              className="btn-primary"
              onClick={() =>
                void download(
                  `/labels/locations?${selected.map((id) => `ids=${id}`).join('&')}`,
                  'location-labels.pdf',
                )
              }
            >
              Print {selected.length} label{selected.length > 1 ? 's' : ''}
            </button>
          )
        }
      />

      <ErrorNote error={tree.error ?? remove.error} />
      {tree.isLoading && <Spinner />}

      {tree.data?.length === 0 && (
        <EmptyState
          title="Nowhere to put anything yet"
          hint="Start with a site like 'Shed A', then add shelves and bins inside it."
        />
      )}

      <div className="space-y-2">
        {tree.data?.map((node) => (
          <LocationRow
            key={node.id}
            node={node}
            depth={0}
            selected={selected}
            onToggle={toggle}
            canEdit={canEdit}
            onDelete={(id) => remove.mutate(id)}
          />
        ))}
      </div>

      {canEdit && <AddLocationForm locations={flat.data ?? []} />}
    </>
  )
}

function LocationRow({
  node,
  depth,
  selected,
  onToggle,
  canEdit,
  onDelete,
}: {
  node: LocationNode
  depth: number
  selected: number[]
  onToggle: (id: number) => void
  canEdit: boolean
  onDelete: (id: number) => void
}) {
  const empty = node.part_count === 0 && node.children.length === 0

  return (
    <>
      <div
        className="card flex items-center gap-3 p-3"
        style={{ marginLeft: `${depth * 1.25}rem` }}
      >
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-slate-300 text-rust focus:ring-rust"
          checked={selected.includes(node.id)}
          onChange={() => onToggle(node.id)}
          aria-label={`Select ${node.name} for printing`}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{node.name}</p>
          <p className="truncate font-mono text-xs text-ink-soft">{node.code}</p>
        </div>
        <span className="chip bg-slate-100 text-ink-soft ring-slate-200">{node.kind}</span>
        {node.part_count > 0 && (
          <Link
            to={`/parts?location_id=${node.id}`}
            className="text-sm font-medium text-rust whitespace-nowrap"
          >
            {node.part_count} part{node.part_count > 1 ? 's' : ''}
          </Link>
        )}
        {canEdit && empty && (
          <button
            type="button"
            className="btn-danger !px-2 !py-1 !text-xs"
            onClick={() => {
              if (confirm(`Delete ${node.name}?`)) onDelete(node.id)
            }}
          >
            Delete
          </button>
        )}
      </div>

      {node.children.map((child) => (
        <LocationRow
          key={child.id}
          node={child}
          depth={depth + 1}
          selected={selected}
          onToggle={onToggle}
          canEdit={canEdit}
          onDelete={onDelete}
        />
      ))}
    </>
  )
}

function AddLocationForm({ locations }: { locations: StorageLocation[] }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [kind, setKind] = useState<LocationKind>('bin')
  const [parentId, setParentId] = useState('')

  const create = useMutation({
    mutationFn: () =>
      api.post('/locations', {
        name: name.trim(),
        kind,
        parent_id: parentId ? Number(parentId) : null,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['locations'] })
      setName('')
    },
  })

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    create.mutate()
  }

  return (
    <form onSubmit={onSubmit} className="card mt-5 space-y-3 p-4">
      <p className="text-sm font-semibold">Add a storage spot</p>
      <ErrorNote error={create.error} />

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Name">
          <input
            className="field"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Bin 4"
            required
          />
        </Field>

        <Field label="Kind">
          <select
            className="field"
            value={kind}
            onChange={(e) => setKind(e.target.value as LocationKind)}
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k[0].toUpperCase() + k.slice(1)}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Inside">
          <select
            className="field"
            value={parentId}
            onChange={(e) => setParentId(e.target.value)}
          >
            <option value="">Top level</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.path}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <button type="submit" className="btn-primary w-full" disabled={create.isPending}>
        {create.isPending ? 'Adding…' : 'Add it'}
      </button>
    </form>
  )
}
