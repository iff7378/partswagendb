import type { PartCondition, PartStatus, VehicleStatus } from './types'

const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

export function money(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  const amount = typeof value === 'string' ? Number(value) : value
  return Number.isNaN(amount) ? '—' : currency.format(amount)
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/

export function date(value: string | null | undefined): string {
  if (!value) return '—'

  // A bare YYYY-MM-DD is parsed as UTC midnight, which renders as the previous
  // day anywhere west of Greenwich. Build it in local time instead.
  const parts = DATE_ONLY.exec(value)
  const parsed = parts
    ? new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]))
    : new Date(value)

  if (Number.isNaN(parsed.getTime())) return '—'

  return parsed.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export const CONDITION_LABELS: Record<PartCondition, string> = {
  new: 'New',
  a: 'Grade A',
  b: 'Grade B',
  c: 'Grade C',
  core: 'Core',
  salvage: 'Salvage',
  unknown: 'Unknown',
}

export const STATUS_LABELS: Record<PartStatus, string> = {
  draft: 'Draft',
  available: 'Available',
  reserved: 'Reserved',
  sold: 'Sold',
  scrapped: 'Scrapped',
}

export const STATUS_STYLES: Record<PartStatus, string> = {
  draft: 'bg-amber-100 text-amber-800 ring-amber-200',
  available: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
  reserved: 'bg-sky-100 text-sky-800 ring-sky-200',
  sold: 'bg-slate-200 text-slate-700 ring-slate-300',
  scrapped: 'bg-rose-100 text-rose-800 ring-rose-200',
}

/** Renders a signed balance, since who-owes-whom hinges on the sign. */
export function signedMoney(value: string): { text: string; className: string } {
  const amount = Number(value)
  if (Number.isNaN(amount) || amount === 0) {
    return { text: money(0), className: 'text-ink-soft' }
  }
  return amount > 0
    ? { text: `+${money(amount)}`, className: 'text-emerald-700' }
    : { text: money(amount), className: 'text-rose-700' }
}

export const VEHICLE_STATUS_LABELS: Record<VehicleStatus, string> = {
  acquired: 'Acquired',
  in_teardown: 'In teardown',
  stripped: 'Stripped',
  scrapped: 'Scrapped',
}

export const VEHICLE_STATUS_HINTS: Record<VehicleStatus, string> = {
  acquired: 'Bought, teardown not started',
  in_teardown: 'Actively pulling parts',
  stripped: 'Parts are out, shell still here',
  scrapped: 'Shell has gone to the yard',
}

export const VEHICLE_STATUS_STYLES: Record<VehicleStatus, string> = {
  acquired: 'bg-sky-100 text-sky-800 ring-sky-200',
  in_teardown: 'bg-amber-100 text-amber-800 ring-amber-200',
  stripped: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
  scrapped: 'bg-slate-200 text-slate-700 ring-slate-300',
}

/** "3 days" / "2 months" — a rough age is easier to read than a day count. */
export function humanAge(days: number): string {
  if (days <= 0) return 'today'
  if (days === 1) return '1 day'
  if (days < 60) return `${days} days`
  const months = Math.round(days / 30)
  if (months < 24) return `${months} months`
  return `${Math.round(days / 365)} years`
}
