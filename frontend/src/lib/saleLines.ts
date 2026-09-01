/**
 * A line is whatever went for one price.
 *
 * `parts` is picked from stock and can be one thing or a whole lot; `shell` is
 * the car itself going to the yard; `other` is anything that was never
 * catalogued, which can still be named against a car so the money lands on it.
 */
export type LineKind = 'parts' | 'shell' | 'other'

export interface Line {
  kind: LineKind
  partIds: number[]
  vehicleId: string
  description: string
  unit_price: string
  quantity: string
}

export const EMPTY_LINE: Line = {
  kind: 'parts',
  partIds: [],
  vehicleId: '',
  description: '',
  unit_price: '',
  quantity: '1',
}

export const KIND_LABELS: Record<LineKind, string> = {
  parts: 'Parts from stock',
  shell: 'The shell, for scrap',
  other: 'Not itemised',
}

/** Strip the UI-only fields and hand the API what it expects. */
export function toPayload(lines: Line[]) {
  return lines
    .filter((line) => line.partIds.length > 0 || line.vehicleId || line.description.trim())
    .map((line) => ({
      part_ids: line.kind === 'parts' ? line.partIds : [],
      vehicle_id: line.kind === 'parts' ? null : Number(line.vehicleId) || null,
      is_shell: line.kind === 'shell',
      description: line.description.trim() || null,
      unit_price: line.unit_price || '0',
      quantity: Number(line.quantity) || 1,
    }))
}

export function subtotalOf(lines: Line[]): number {
  return lines.reduce(
    (sum, line) => sum + (Number(line.unit_price) || 0) * (Number(line.quantity) || 1),
    0,
  )
}
