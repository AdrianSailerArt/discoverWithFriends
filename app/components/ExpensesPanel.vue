<script setup lang="ts">
import type { ChartOption } from '~/lib/charts'
import {
  CURRENCIES,
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_KEYS,
  computeBalances,
  formatMoney,
  parseAmount,
  settleUp,
  splitEvenly,
  totalsByCategory,
  type Transfer,
} from '~/lib/expenses'
import type { Expense, ExpenseCategory, Member, TripData } from '~/lib/types'

const props = defineProps<{
  data: TripData
  membersById: Record<string, Member>
  myId: string
}>()
const emit = defineEmits<{ saved: [] }>()

const backend = useBackend()
const currency = computed(() => props.data.trip.currency ?? 'EUR')
const money = (cents: number) => formatMoney(cents, currency.value)
const members = computed(() => props.data.members)
const isOwner = computed(() => members.value.some((m) => m.user_id === props.myId && m.role === 'owner'))
const name = (id: string) => props.membersById[id]?.display_name ?? 'Ehemalig'
const color = (id: string) => props.membersById[id]?.color ?? '#8a9199'

const expenses = computed(() => props.data.expenses ?? [])
const realExpenses = computed(() => expenses.value.filter((e) => e.kind === 'expense'))
const total = computed(() => realExpenses.value.reduce((s, e) => s + e.amount_cents, 0))
const balances = computed(() => computeBalances(expenses.value, members.value.map((m) => m.user_id)))
const ranking = computed(() => [...balances.value].sort((a, b) => b.paid - a.paid))
const transfers = computed(() => settleUp(balances.value))
const byCategory = computed(() => totalsByCategory(expenses.value))

const error = ref<string | null>(null)
const busy = ref(false)

// --- form ---------------------------------------------------------------------
interface FormState {
  id: string | null
  title: string
  amount: string
  category: ExpenseCategory
  paid_by: string
  spent_on: string
  participants: string[]
}
const form = ref<FormState | null>(null)
const today = () => new Date().toISOString().slice(0, 10)

function startAdd() {
  error.value = null
  form.value = {
    id: null,
    title: '',
    amount: '',
    category: 'food',
    paid_by: props.myId,
    spent_on: today(),
    participants: members.value.map((m) => m.user_id),
  }
}

function startEdit(e: Expense) {
  if (!canEdit(e)) return
  error.value = null
  form.value = {
    id: e.id,
    title: e.title,
    amount: (e.amount_cents / 100).toFixed(2).replace('.', ','),
    category: e.category,
    paid_by: e.paid_by,
    spent_on: e.spent_on,
    participants: [...e.participants],
  }
}

const canEdit = (e: Expense) => e.created_by === props.myId || e.paid_by === props.myId || isOwner.value

const formCents = computed(() => (form.value ? parseAmount(form.value.amount) : null))
const perHead = computed(() => {
  if (!form.value || !formCents.value || !form.value.participants.length) return null
  return Math.max(...splitEvenly(formCents.value, form.value.participants).values())
})

function toggleParticipant(id: string) {
  const f = form.value!
  f.participants = f.participants.includes(id) ? f.participants.filter((x) => x !== id) : [...f.participants, id]
}

async function save() {
  const f = form.value
  if (!f) return
  const cents = parseAmount(f.amount)
  if (!cents) return void (error.value = 'Bitte einen gültigen Betrag eingeben, z. B. 12,50.')
  if (!f.participants.length) return void (error.value = 'Mindestens eine Person muss beteiligt sein.')
  busy.value = true
  error.value = null
  try {
    await backend.saveExpense(
      props.data.trip.id,
      {
        title: f.title.trim(),
        amount_cents: cents,
        category: f.category,
        kind: 'expense',
        paid_by: f.paid_by,
        spent_on: f.spent_on || today(),
        participants: f.participants,
      },
      f.id,
    )
    form.value = null
    emit('saved')
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    busy.value = false
  }
}

async function remove() {
  const f = form.value
  if (!f?.id || !confirm(`„${f.title}“ löschen?`)) return
  busy.value = true
  try {
    await backend.deleteExpense(f.id)
    form.value = null
    emit('saved')
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    busy.value = false
  }
}

/** Records a settlement payment so the suggestion disappears from the balances. */
async function markPaid(t: Transfer) {
  if (!confirm(`${name(t.from)} hat ${name(t.to)} ${money(t.cents)} überwiesen?`)) return
  busy.value = true
  error.value = null
  try {
    await backend.saveExpense(
      props.data.trip.id,
      {
        title: 'Ausgleich',
        amount_cents: t.cents,
        category: 'other',
        kind: 'transfer',
        paid_by: t.from,
        spent_on: today(),
        participants: [t.to],
      },
      null,
    )
    emit('saved')
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    busy.value = false
  }
}

async function changeCurrency(e: Event) {
  const value = (e.target as HTMLSelectElement).value
  try {
    await backend.setTripCurrency(props.data.trip.id, value)
    emit('saved')
  } catch (err) {
    error.value = errorMessage(err)
  }
}

// --- charts ---------------------------------------------------------------------
const rankingChart = computed<ChartOption>(() => {
  const rows = [...ranking.value].reverse() // largest on top in a horizontal bar chart
  return {
    grid: { left: 8, right: 16, top: 28, bottom: 8, containLabel: true },
    legend: { top: 0, left: 0, itemWidth: 12, itemHeight: 12, data: ['Bezahlt', 'Eigener Anteil'] },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      valueFormatter: (v) => money(Math.round(Number(v) * 100)),
    },
    xAxis: { type: 'value', axisLabel: { formatter: (v: number) => `${v}` } },
    yAxis: { type: 'category', data: rows.map((r) => name(r.userId)), axisTick: { show: false } },
    series: [
      {
        name: 'Bezahlt',
        type: 'bar',
        barMaxWidth: 18,
        // legend swatch; the bars themselves use each person's colour
        itemStyle: { color: '#922625' },
        data: rows.map((r) => ({ value: r.paid / 100, itemStyle: { color: color(r.userId) } })),
      },
      {
        name: 'Eigener Anteil',
        type: 'bar',
        barMaxWidth: 18,
        itemStyle: { color: '#8a9199', opacity: 0.55 },
        data: rows.map((r) => r.share / 100),
      },
    ],
  }
})

const categoryChart = computed<ChartOption>(() => ({
  tooltip: {
    trigger: 'item',
    valueFormatter: (v) => money(Math.round(Number(v) * 100)),
  },
  legend: { bottom: 0, left: 'center', itemWidth: 10, itemHeight: 10 },
  series: [
    {
      type: 'pie',
      radius: ['45%', '72%'],
      center: ['50%', '42%'],
      avoidLabelOverlap: true,
      label: { show: false },
      itemStyle: { borderColor: 'rgba(0,0,0,0.85)', borderWidth: 1 },
      data: byCategory.value.map(([cat, cents]) => ({
        name: `${EXPENSE_CATEGORIES[cat].emoji} ${EXPENSE_CATEGORIES[cat].label}`,
        value: cents / 100,
        itemStyle: { color: EXPENSE_CATEGORIES[cat].color },
      })),
    },
  ],
}))

const medal = (i: number) => ['🥇', '🥈', '🥉'][i] ?? `${i + 1}.`
const fmtDate = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('de-DE', { day: 'numeric', month: 'short' })
</script>

<template>
  <div class="expenses">
    <p v-if="data.expenses === null" class="notice small">
      Die Kostenfunktion ist in der Datenbank noch nicht eingerichtet. Bitte
      <code>supabase/migrations/0005_expenses.sql</code> im Supabase SQL Editor ausführen.
    </p>

    <!-- Form -->
    <form v-else-if="form" class="form" @submit.prevent="save">
      <h2>{{ form.id ? 'Ausgabe bearbeiten' : 'Neue Ausgabe' }}</h2>
      <label>
        Wofür?
        <input v-model="form.title" required maxlength="160" placeholder="z. B. Eintritt Museum" autofocus />
      </label>
      <div class="grid2">
        <label>
          Betrag ({{ currency }})
          <input v-model="form.amount" required inputmode="decimal" placeholder="45,00" />
        </label>
        <label>
          Datum
          <input v-model="form.spent_on" type="date" required />
        </label>
      </div>
      <fieldset class="cats">
        <legend class="lbl">Kategorie</legend>
        <label v-for="k in EXPENSE_CATEGORY_KEYS" :key="k" class="cat" :class="{ active: form.category === k }">
          <input v-model="form.category" type="radio" name="expense-category" :value="k" />
          {{ EXPENSE_CATEGORIES[k].emoji }} {{ EXPENSE_CATEGORIES[k].label }}
        </label>
      </fieldset>
      <label>
        Bezahlt von
        <select v-model="form.paid_by">
          <option v-for="m in members" :key="m.user_id" :value="m.user_id">
            {{ m.display_name }}{{ m.user_id === myId ? ' (du)' : '' }}
          </option>
        </select>
      </label>

      <fieldset class="people">
        <legend class="lbl row between">
          <span>Wer war dabei? <strong>{{ form.participants.length }} von {{ members.length }}</strong></span>
          <span class="row tight">
            <button type="button" class="link-btn" @click="form.participants = members.map((m) => m.user_id)">Alle</button>
            <button type="button" class="link-btn" @click="form.participants = []">Keiner</button>
          </span>
        </legend>
        <label
          v-for="m in members"
          :key="m.user_id"
          class="person"
          :class="{ on: form.participants.includes(m.user_id) }"
        >
          <input type="checkbox" :checked="form.participants.includes(m.user_id)" @change="toggleParticipant(m.user_id)" />
          <span class="dot" :style="{ background: m.color }" />
          {{ m.display_name }}{{ m.user_id === myId ? ' (du)' : '' }}
          <span v-if="form.participants.includes(m.user_id) && formCents" class="muted share">
            {{ money(splitEvenly(formCents, form.participants).get(m.user_id) ?? 0) }}
          </span>
        </label>
      </fieldset>
      <p v-if="perHead" class="muted small">
        {{ money(formCents!) }} geteilt durch {{ form.participants.length }} – je ca. {{ money(perHead) }}.
        <template v-if="form.participants.length < members.length">
          {{ members.length - form.participants.length }} {{ members.length - form.participants.length === 1 ? 'Person zahlt' : 'Personen zahlen' }} nichts.
        </template>
      </p>

      <p v-if="error" class="error">{{ error }}</p>
      <div class="row">
        <button class="btn primary" :disabled="busy">{{ busy ? 'Speichere…' : 'Speichern' }}</button>
        <button type="button" class="btn" @click="form = null; error = null">Abbrechen</button>
        <button v-if="form.id" type="button" class="btn danger" :disabled="busy" @click="remove">Löschen</button>
      </div>
    </form>

    <!-- Overview -->
    <template v-else>
      <div class="head">
        <div>
          <div class="overline">Gesamtausgaben</div>
          <div class="total">{{ money(total) }}</div>
          <div class="muted small">
            {{ realExpenses.length }} {{ realExpenses.length === 1 ? 'Ausgabe' : 'Ausgaben' }}
            <template v-if="members.length"> · Ø {{ money(Math.round(total / members.length)) }} pro Person</template>
          </div>
        </div>
        <select v-if="isOwner" class="currency" :value="currency" aria-label="Währung" @change="changeCurrency">
          <option v-for="c in CURRENCIES" :key="c" :value="c">{{ c }}</option>
        </select>
        <span v-else class="muted small">{{ currency }}</span>
      </div>

      <button class="btn primary add" @click="startAdd">+ Ausgabe erfassen</button>
      <p v-if="error" class="error">{{ error }}</p>

      <p v-if="!expenses.length" class="muted">
        Noch keine Ausgaben. Erfasst Eintritte, Essen, Sprit oder Unterkünfte – bei jeder Ausgabe könnt ihr festlegen,
        wer dabei war. Nur diese Personen teilen sich die Kosten.
      </p>

      <template v-else>
        <!-- Ranking -->
        <section class="block">
          <h3>Wer hat am meisten bezahlt?</h3>
          <EChart :option="rankingChart" :height="`${Math.max(140, members.length * 44 + 40)}px`" label="Balkendiagramm: bezahlt und eigener Anteil pro Person" />
          <ol class="ranking">
            <li v-for="(r, i) in ranking" :key="r.userId">
              <span class="medal">{{ medal(i) }}</span>
              <span class="dot" :style="{ background: color(r.userId) }" />
              <span class="who">{{ name(r.userId) }}</span>
              <span class="amount">{{ money(r.paid) }}</span>
            </li>
          </ol>
        </section>

        <!-- Balances + settle up -->
        <section class="block">
          <h3>Wer schuldet wem?</h3>
          <ul class="balances">
            <li v-for="b in balances" :key="b.userId">
              <span class="dot" :style="{ background: color(b.userId) }" />
              <span class="who">{{ name(b.userId) }}</span>
              <span v-if="b.balance > 0" class="pos">bekommt {{ money(b.balance) }}</span>
              <span v-else-if="b.balance < 0" class="neg">schuldet {{ money(-b.balance) }}</span>
              <span v-else class="muted">ausgeglichen ✓</span>
            </li>
          </ul>
          <p v-if="!transfers.length" class="muted small">Alles ausgeglichen – niemand schuldet jemandem etwas.</p>
          <ul v-else class="transfers">
            <li v-for="(t, i) in transfers" :key="i">
              <span>
                <strong>{{ name(t.from) }}</strong> → <strong>{{ name(t.to) }}</strong>
                <span class="amount">{{ money(t.cents) }}</span>
              </span>
              <button class="btn small" :disabled="busy" @click="markPaid(t)">Als bezahlt markieren</button>
            </li>
          </ul>
        </section>

        <!-- Categories -->
        <section v-if="byCategory.length" class="block">
          <h3>Wofür geht das Geld drauf?</h3>
          <EChart :option="categoryChart" height="260px" label="Ringdiagramm: Ausgaben nach Kategorie" />
        </section>

        <!-- List -->
        <section class="block">
          <h3>Alle Buchungen</h3>
          <ul class="list">
            <li v-for="e in expenses" :key="e.id">
              <button type="button" class="item" :class="{ transfer: e.kind === 'transfer' }" :disabled="!canEdit(e) || e.kind === 'transfer'" @click="startEdit(e)">
                <span class="emoji">{{ e.kind === 'transfer' ? '🔁' : EXPENSE_CATEGORIES[e.category].emoji }}</span>
                <span class="item-main">
                  <strong>{{ e.kind === 'transfer' ? `${name(e.paid_by)} → ${name(e.participants[0] ?? '')}` : e.title }}</strong>
                  <span class="muted small">
                    {{ fmtDate(e.spent_on) }} ·
                    <template v-if="e.kind === 'transfer'">Ausgleich</template>
                    <template v-else>
                      bezahlt von {{ name(e.paid_by) }} ·
                      {{ e.participants.length === members.length ? 'alle' : `${e.participants.length} von ${members.length}` }}
                    </template>
                  </span>
                </span>
                <span class="amount">{{ money(e.amount_cents) }}</span>
              </button>
              <button
                v-if="e.kind === 'transfer' && canEdit(e)"
                class="link-btn undo"
                :disabled="busy"
                @click="backend.deleteExpense(e.id).then(() => emit('saved'))"
              >
                rückgängig
              </button>
            </li>
          </ul>
        </section>
      </template>
    </template>
  </div>
</template>

<style scoped>
.expenses {
  display: grid;
  gap: 14px;
}
.form {
  display: grid;
  gap: 12px;
}
.form h2,
.form p,
.block h3 {
  margin: 0;
}
.grid2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.lbl {
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--muted);
  margin-bottom: 4px;
  width: 100%;
}
.between {
  justify-content: space-between;
}
.tight {
  gap: 10px;
}
.cats,
.people {
  border: 0;
  padding: 0;
  margin: 0;
}
.cats {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.cat {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-tag);
  cursor: pointer;
  color: var(--text);
  font-size: 0.85rem;
}
.cat.active {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.cat input {
  position: absolute;
  opacity: 0;
  width: 0;
  pointer-events: none;
}
.people {
  display: grid;
  gap: 4px;
}
.person {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  color: var(--text);
  font-size: 0.95rem;
  cursor: pointer;
}
.person.on {
  border-color: var(--line);
  background: var(--accent-soft);
}
.person input {
  width: 18px;
  height: 18px;
  min-height: 0;
  margin: 0;
  accent-color: var(--accent);
}
.share {
  margin-left: auto;
  font-size: 0.85rem;
}
.small {
  font-size: 0.8rem;
}
.head {
  display: flex;
  justify-content: space-between;
  align-items: start;
  gap: 12px;
}
.total {
  font-size: 1.8rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.1;
}
.currency {
  width: auto;
  min-height: 2rem;
  padding: 0.2rem 0.4rem;
  font-size: 0.85rem;
}
.add {
  width: 100%;
}
.block {
  display: grid;
  gap: 8px;
  border-top: 1px solid var(--line);
  padding-top: 12px;
}
.block h3 {
  font-size: 1rem;
}
.ranking,
.balances,
.transfers,
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 6px;
}
.ranking li,
.balances li {
  display: flex;
  align-items: center;
  gap: 8px;
}
.medal {
  width: 1.6rem;
  text-align: center;
}
.who {
  flex: 1;
}
.amount {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  white-space: nowrap;
}
.pos {
  color: #00995c;
  font-weight: 600;
}
.neg {
  color: var(--danger);
  font-weight: 600;
}
@media (prefers-color-scheme: dark) {
  .pos {
    color: #33cc85;
  }
}
.transfers li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 8px 10px;
  background: var(--surface-2);
}
.transfers .amount {
  margin-left: 6px;
}
.list li {
  display: grid;
  gap: 2px;
}
.item {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 10px;
  width: 100%;
  text-align: left;
  padding: 10px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  cursor: pointer;
}
.item:hover:not(:disabled) {
  background: var(--surface-2);
}
.item:disabled {
  cursor: default;
  opacity: 1;
}
.item.transfer {
  background: transparent;
  border-style: dashed;
}
.item-main {
  display: grid;
  min-width: 0;
}
.emoji {
  font-size: 1.2rem;
}
.link-btn {
  border: 0;
  background: none;
  padding: 0;
  color: var(--accent);
  text-decoration: underline;
  cursor: pointer;
  font: inherit;
  font-size: 0.8rem;
}
.undo {
  justify-self: end;
}
</style>
