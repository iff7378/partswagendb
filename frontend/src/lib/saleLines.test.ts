import { describe, expect, it } from 'vitest'

import { voidWarning } from './saleLines'
import type { SaleDetail, SaleItem } from './types'

function line(partial: Partial<SaleItem> = {}): SaleItem {
  return {
    id: 1,
    parts: [],
    vehicle_id: null,
    vehicle_name: null,
    is_shell: false,
    description: 'Something',
    quantity: 1,
    unit_price: '10.00',
    line_total: '10.00',
    ...partial,
  }
}

function sale(partial: Partial<SaleDetail> = {}): SaleDetail {
  return {
    id: 1,
    reference: 'S26-0012',
    sold_on: '2026-09-01',
    paid_on: null,
    fulfilled_on: null,
    meetup_at: null,
    voided_at: null,
    void_reason: null,
    voided_by: null,
    state: 'pending',
    channel: 'local',
    buyer_name: null,
    buyer_contact: null,
    shipping: '0',
    fees: '0',
    tax: '0',
    subtotal: '10.00',
    net_collected: '10.00',
    collected_by_id: 1,
    collected_by: { id: 1, full_name: 'Ian', email: 'ian@example.com' },
    payment_method: null,
    notes: null,
    created_at: '2026-09-01T00:00:00Z',
    items: [line()],
    ...partial,
  }
}

describe('voidWarning', () => {
  it('promises nothing back when the sale holds no parts', () => {
    expect(voidWarning(sale())).toBe(
      'Void S26-0012? The settle-up report is unaffected, as it was never paid.',
    )
  })

  it('does not claim a car un-scraps for a lot booked against it', () => {
    const warning = voidWarning(
      sale({ items: [line({ vehicle_id: 3, vehicle_name: 'DubiousWagen' })] }),
    )
    expect(warning).not.toContain('stripped')
  })

  it('says the car reverts only for a shell line', () => {
    const warning = voidWarning(
      sale({
        paid_on: '2026-09-01',
        items: [line({ is_shell: true, vehicle_id: 3, vehicle_name: 'Crashwagen' })],
      }),
    )
    expect(warning).toBe(
      'Void S26-0012? Crashwagen goes back to stripped and the settle-up report changes.',
    )
  })

  it('counts the parts it will actually return', () => {
    const parts = [
      { id: 1, sku: 'P-000001', title: 'Seats' },
      { id: 2, sku: 'P-000002', title: 'Dash' },
    ]
    expect(voidWarning(sale({ paid_on: '2026-09-01', items: [line({ parts })] }))).toBe(
      'Void S26-0012? 2 parts go back into stock and the settle-up report changes.',
    )
  })

  it('uses the singular for one part', () => {
    const parts = [{ id: 1, sku: 'P-000001', title: 'Seats' }]
    expect(voidWarning(sale({ items: [line({ parts })] }))).toContain('1 part goes back into stock')
  })
})
