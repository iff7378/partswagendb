import type {
  ExpenseCategory,
  PartCondition,
  PartStatus,
  SaleState,
  VehicleStatus,
} from './types'

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

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  purchase: 'Buying a car',
  transport: 'Towing and transport',
  tooling: 'Tools',
  disposal: 'Disposal',
  storage: 'Storage',
  fees: 'Fees',
  supplies: 'Supplies',
  meals: 'Food',
  other: 'Other',
}

/** Byte counts for humans. Metric units, because that is what disks are sold in. */
export function bytes(value: number): string {
  if (value < 1000) return `${value} B`
  const units = ['kB', 'MB', 'GB', 'TB']
  let n = value / 1000
  let i = 0
  while (n >= 1000 && i < units.length - 1) {
    n /= 1000
    i += 1
  }
  return `${n.toFixed(n < 10 ? 1 : 0)} ${units[i]}`
}

export const SALE_STATE_LABELS: Record<SaleState, string> = {
  pending: 'Agreed',
  paid: 'Paid, not collected',
  gone: 'Gone, not paid',
  complete: 'Done',
  voided: 'Voided',
}

export const SALE_STATE_HINTS: Record<SaleState, string> = {
  pending: 'Agreed to sell. The parts are held but still on the shelf.',
  paid: 'Money is in. The parts are still here waiting to be collected.',
  gone: 'The parts have left but the money has not landed yet.',
  complete: 'Paid for and gone.',
  voided: 'Cancelled. Kept for the record, but counts towards nothing.',
}

export const SALE_STATE_STYLES: Record<SaleState, string> = {
  pending: 'bg-slate-100 text-slate-700 ring-slate-200',
  paid: 'bg-sky-100 text-sky-800 ring-sky-200',
  gone: 'bg-amber-100 text-amber-900 ring-amber-200',
  complete: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
  voided: 'bg-slate-100 text-slate-500 ring-slate-200',
}

/** "Sat, Sep 5 at 5:00 PM" — an instant, rendered in the reader's own zone. */
export function dateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '—'
  return parsed.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/** Just the clock part, for rows already grouped under a day heading. */
export function timeOfDay(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '—'
  return parsed.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

/**
 * An ISO instant as `<input type="datetime-local">` wants it: local wall clock,
 * no zone. Going through the epoch keeps the offset correct either side of a
 * daylight-saving change.
 */
export function toLocalInput(value: string | null): string {
  if (!value) return ''
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''
  const offset = parsed.getTimezoneOffset() * 60_000
  return new Date(parsed.getTime() - offset).toISOString().slice(0, 16)
}

/** The reverse: what the picker gives back, as a full instant for the API. */
export function fromLocalInput(value: string): string | null {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

/** Today, tomorrow, overdue — the words you would actually use. */
export function dayLabel(value: string): string {
  const when = new Date(value)
  const today = new Date()
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((startOf(when) - startOf(today)) / 86_400_000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days === -1) return 'Yesterday'
  if (days < 0) return `${date(when.toISOString())} · overdue`
  return when.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  })
}
