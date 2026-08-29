import type { PartCondition, PartStatus } from './types'

const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

export function money(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  const amount = typeof value === 'string' ? Number(value) : value
  return Number.isNaN(amount) ? '—' : currency.format(amount)
}

export function date(value: string | null | undefined): string {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-US', {
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
