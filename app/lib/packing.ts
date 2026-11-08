import type { PackCategory, PackingInput } from './types'

export const PACK_CATEGORIES: Record<PackCategory, { label: string; emoji: string }> = {
  docs: { label: 'Dokumente & Geld', emoji: '🛂' },
  clothes: { label: 'Kleidung', emoji: '🧥' },
  hygiene: { label: 'Hygiene', emoji: '🪥' },
  health: { label: 'Gesundheit', emoji: '🩹' },
  tech: { label: 'Technik', emoji: '🔌' },
  gear: { label: 'Ausrüstung', emoji: '🎒' },
  food: { label: 'Proviant', emoji: '🥪' },
  other: { label: 'Sonstiges', emoji: '📦' },
}

export const PACK_CATEGORY_KEYS = Object.keys(PACK_CATEGORIES) as PackCategory[]

/** Ready-made lists to start from – each adds only what's not on the list yet. */
export const PACK_TEMPLATES: { id: string; label: string; emoji: string; items: [string, PackCategory][] }[] = [
  {
    id: 'basics',
    label: 'Basics',
    emoji: '🧳',
    items: [
      ['Personalausweis / Reisepass', 'docs'],
      ['Führerschein', 'docs'],
      ['Kreditkarte & Bargeld', 'docs'],
      ['Krankenversicherungskarte', 'docs'],
      ['Buchungsbestätigungen', 'docs'],
      ['Unterwäsche & Socken', 'clothes'],
      ['T-Shirts', 'clothes'],
      ['Pullover', 'clothes'],
      ['Schlafsachen', 'clothes'],
      ['Zahnbürste & Zahnpasta', 'hygiene'],
      ['Duschgel & Shampoo', 'hygiene'],
      ['Deo', 'hygiene'],
      ['Medikamente', 'health'],
      ['Handy & Ladekabel', 'tech'],
      ['Powerbank', 'tech'],
      ['Reiseadapter', 'tech'],
    ],
  },
  {
    id: 'outdoor',
    label: 'Wandern & Outdoor',
    emoji: '🥾',
    items: [
      ['Wanderschuhe', 'clothes'],
      ['Regenjacke', 'clothes'],
      ['Regenhose', 'clothes'],
      ['Funktionsshirts', 'clothes'],
      ['Mütze & Handschuhe', 'clothes'],
      ['Tagesrucksack', 'gear'],
      ['Trinkflasche', 'gear'],
      ['Stirnlampe', 'gear'],
      ['Taschenmesser', 'gear'],
      ['Offline-Karten / Wanderkarte', 'gear'],
      ['Mückenschutz', 'health'],
      ['Sonnencreme', 'health'],
      ['Erste-Hilfe-Set', 'health'],
      ['Blasenpflaster', 'health'],
      ['Müsliriegel & Snacks', 'food'],
    ],
  },
  {
    id: 'roadtrip',
    label: 'Roadtrip',
    emoji: '🚗',
    items: [
      ['Mietwagen-Bestätigung', 'docs'],
      ['Internationaler Führerschein', 'docs'],
      ['Kfz-Ladekabel / USB-Adapter', 'tech'],
      ['Handyhalterung', 'tech'],
      ['Playlist / Podcasts offline', 'tech'],
      ['Kühltasche', 'gear'],
      ['Snacks für die Fahrt', 'food'],
      ['Wasser', 'food'],
      ['Müllbeutel', 'other'],
    ],
  },
  {
    id: 'beach',
    label: 'Strand & Sommer',
    emoji: '🏖️',
    items: [
      ['Badesachen', 'clothes'],
      ['Sonnenhut / Cap', 'clothes'],
      ['Sonnenbrille', 'clothes'],
      ['Flip-Flops', 'clothes'],
      ['Strandtuch', 'gear'],
      ['Sonnencreme', 'health'],
      ['After-Sun', 'health'],
    ],
  },
]

const norm = (s: string) => s.trim().toLocaleLowerCase('de-DE')

/** Items of a template that are not yet on the list (by title). */
export function missingFromTemplate(templateId: string, existing: { title: string }[]): PackingInput[] {
  const tpl = PACK_TEMPLATES.find((t) => t.id === templateId)
  if (!tpl) return []
  const have = new Set(existing.map((e) => norm(e.title)))
  return tpl.items
    .filter(([title]) => !have.has(norm(title)))
    .map(([title, category]) => ({ title, category, quantity: 1, assigned_to: null }))
}

/** Guess a category from the title so quick-add needs no extra click. */
export function guessCategory(title: string): PackCategory {
  const t = norm(title)
  for (const tpl of PACK_TEMPLATES) for (const [name, cat] of tpl.items) if (norm(name) === t) return cat
  const rules: [RegExp, PackCategory][] = [
    [/pass|ausweis|karte|geld|ticket|visum|bestätigung|versicherung|führerschein/, 'docs'],
    [/jacke|hose|shirt|pullover|socke|schuh|mütze|kleid|hemd|unterwäsche|bade|schal|handschuh|brille|\bcap\b|\bhut\b/, 'clothes'],
    [/zahn|shampoo|dusch|deo|seife|kamm|rasier|creme|handtuch/, 'hygiene'],
    [/medik|tablette|pflaster|erste.hilfe|mücken|sonnen|schmerz|apotheke/, 'health'],
    [/lade|kabel|handy|kamera|powerbank|adapter|kopfhörer|laptop|akku|tablet/, 'tech'],
    [/rucksack|zelt|schlafsack|lampe|messer|flasche|stöcke|karte|isomatte/, 'gear'],
    [/snack|essen|wasser|riegel|kaffee|tee|proviant|obst/, 'food'],
  ]
  return rules.find(([re]) => re.test(t))?.[1] ?? 'other'
}
