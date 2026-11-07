import type { Expense, ExpenseCategory } from './types'

export const EXPENSE_CATEGORIES: Record<ExpenseCategory, { label: string; emoji: string; color: string }> = {
  stay: { label: 'Unterkunft', emoji: '🛏️', color: '#922625' },
  food: { label: 'Essen & Trinken', emoji: '🍽️', color: '#d98e04' },
  transport: { label: 'Transport', emoji: '🚗', color: '#2e86ab' },
  tickets: { label: 'Eintritt & Tickets', emoji: '🎟️', color: '#6c4ab6' },
  activity: { label: 'Aktivitäten', emoji: '🛶', color: '#17a398' },
  shopping: { label: 'Einkäufe', emoji: '🛍️', color: '#e4572e' },
  other: { label: 'Sonstiges', emoji: '📦', color: '#65718f' },
}
export const EXPENSE_CATEGORY_KEYS = Object.keys(EXPENSE_CATEGORIES) as ExpenseCategory[]

export const CURRENCIES = ['EUR', 'GBP', 'CHF', 'USD', 'NOK', 'SEK', 'DKK', 'ISK', 'CZK', 'PLN']

export function formatMoney(cents: number, currency = 'EUR') {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency }).format(cents / 100)
}

/** "12,5" / "12.50" / "1.234,56" → cents; null if invalid */
export function parseAmount(text: string): number | null {
  let t = text.trim().replace(/\s|€|£|\$/g, '')
  if (!t) return null
  // German style "1.234,56" → "1234.56"; plain "12,5" → "12.5"
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null
  const cents = Math.round(Number(t) * 100)
  return cents > 0 ? cents : null
}

/**
 * Splits an amount evenly; leftover cents go to the first participants (sorted by id,
 * so every device computes the same result).
 */
export function splitEvenly(amountCents: number, participants: string[]): Map<string, number> {
  const ids = [...new Set(participants)].sort()
  const out = new Map<string, number>()
  if (!ids.length) return out
  const base = Math.floor(amountCents / ids.length)
  let rest = amountCents - base * ids.length
  for (const id of ids) {
    out.set(id, base + (rest > 0 ? 1 : 0))
    if (rest > 0) rest--
  }
  return out
}

export interface PersonBalance {
  userId: string
  /** spent for the group (real expenses only, no settlement transfers) */
  paid: number
  /** own share of real expenses */
  share: number
  /** > 0: gets money back, < 0: owes money (incl. transfers) */
  balance: number
}

export function computeBalances(expenses: Expense[], memberIds: string[]): PersonBalance[] {
  const people = new Map<string, PersonBalance>()
  const get = (id: string) => {
    let p = people.get(id)
    if (!p) {
      p = { userId: id, paid: 0, share: 0, balance: 0 }
      people.set(id, p)
    }
    return p
  }
  memberIds.forEach(get)

  for (const e of expenses) {
    const shares = splitEvenly(e.amount_cents, e.participants)
    get(e.paid_by).balance += e.amount_cents
    if (e.kind === 'expense') get(e.paid_by).paid += e.amount_cents
    for (const [id, cents] of shares) {
      get(id).balance -= cents
      if (e.kind === 'expense') get(id).share += cents
    }
  }
  return [...people.values()]
}

export interface Transfer {
  from: string
  to: string
  cents: number
}

/** Few transfers that settle all balances (greedy: largest debtor pays largest creditor). */
export function settleUp(balances: PersonBalance[]): Transfer[] {
  const debtors = balances.filter((b) => b.balance < 0).map((b) => ({ id: b.userId, cents: -b.balance }))
  const creditors = balances.filter((b) => b.balance > 0).map((b) => ({ id: b.userId, cents: b.balance }))
  debtors.sort((a, b) => b.cents - a.cents)
  creditors.sort((a, b) => b.cents - a.cents)
  const out: Transfer[] = []
  let i = 0
  let j = 0
  while (i < debtors.length && j < creditors.length) {
    const d = debtors[i]!
    const c = creditors[j]!
    const cents = Math.min(d.cents, c.cents)
    if (cents > 0) out.push({ from: d.id, to: c.id, cents })
    d.cents -= cents
    c.cents -= cents
    if (d.cents === 0) i++
    if (c.cents === 0) j++
  }
  return out
}

export function totalsByCategory(expenses: Expense[]) {
  const out = new Map<ExpenseCategory, number>()
  for (const e of expenses) if (e.kind === 'expense') out.set(e.category, (out.get(e.category) ?? 0) + e.amount_cents)
  return [...out.entries()].sort((a, b) => b[1] - a[1])
}
