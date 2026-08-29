import { describe, expect, it } from 'vitest'

import { date, money, signedMoney } from './format'

describe('money', () => {
  it('formats decimal strings from the API', () => {
    expect(money('1234.50')).toBe('$1,234.50')
  })

  it('shows a dash rather than $NaN for missing values', () => {
    expect(money(null)).toBe('—')
    expect(money(undefined)).toBe('—')
    expect(money('')).toBe('—')
    expect(money('not a number')).toBe('—')
  })

  it('keeps negative amounts negative', () => {
    expect(money('-500.00')).toBe('-$500.00')
  })
})

describe('signedMoney', () => {
  it('marks a surplus as positive and green', () => {
    const result = signedMoney('1750.00')
    expect(result.text).toBe('+$1,750.00')
    expect(result.className).toContain('emerald')
  })

  it('marks a shortfall as negative and red', () => {
    const result = signedMoney('-1750.00')
    expect(result.text).toBe('-$1,750.00')
    expect(result.className).toContain('rose')
  })

  it('treats an exact zero as neutral', () => {
    const result = signedMoney('0.00')
    expect(result.text).toBe('$0.00')
    expect(result.className).toContain('ink-soft')
  })
})

describe('date', () => {
  it('does not shift a date-only string back a day', () => {
    // Parsed as UTC midnight this renders as Jun 30 in any negative offset.
    expect(date('2026-07-01')).toBe('Jul 1, 2026')
    expect(date('2026-09-30')).toBe('Sep 30, 2026')
    expect(date('2026-01-01')).toBe('Jan 1, 2026')
  })

  it('still handles full timestamps', () => {
    expect(date('2026-08-29T17:55:48.999841Z')).toMatch(/Aug 2\d, 2026/)
  })

  it('shows a dash for missing or unparseable values', () => {
    expect(date(null)).toBe('—')
    expect(date('')).toBe('—')
    expect(date('nonsense')).toBe('—')
  })
})
