// Interface strings per language. Pure; detecting the language needs `$`, so it lives in register.ts.
import type { Filter } from '../types'

export type Lang = 'en' | 'pt'

export const isPortuguese = (v: unknown): boolean => typeof v === 'string' && /^(pt|portugu)/i.test(v.trim())

export const strings = {
  en: {
    today: 'today',
    // The /horas panel.
    pane: 'Hours',
    paneHint: 'Show or hide the time worked per folder',
    opened: 'Hours panel opened',
    closed: 'Hours panel closed',
    total: 'Total',
    empty: 'No time worked yet. Time counts while you work with Claude in a project.',
    // #5 days and filters
    noTime: 'No time worked in this period.',
    pickHint: 'Press a time to see its days.',
    // Manual pause (#8).
    pause: '⏸ Pause',
    resume: '▶ Resume',
    paused: 'Paused: this session is not counting time.',
  },
  pt: {
    today: 'hoje',
    pane: 'Horas',
    paneHint: 'Mostra ou esconde o tempo trabalhado por pasta',
    opened: 'Painel de horas aberto',
    closed: 'Painel de horas fechado',
    total: 'Total',
    empty: 'Nenhum tempo trabalhado ainda. O tempo conta enquanto você trabalha com o Claude num projeto.',
    noTime: 'Nenhum tempo trabalhado neste período.',
    pickHint: 'Pressione um tempo para ver os dias dele.',
    pause: '⏸ Pausar',
    resume: '▶ Retomar',
    paused: 'Em pausa: esta sessão não está contando tempo.',
  },
} satisfies Record<Lang, Record<string, string>>

// --- #5 days and filters
export const filters: Record<Lang, Record<Filter, string>> = {
  en: { today: 'Today', week: 'Week', month: 'Month', all: 'All' },
  pt: { today: 'Hoje', week: 'Semana', month: 'Mês', all: 'Total' },
}

const weekdays = { en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], pt: ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'] }
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** A day key as a row reads it: `seg 12/10` or `Mon Oct 12`. */
export function dayLabel(day: string, lang: Lang): string {
  const d = new Date(`${day}T00:00`) // no offset: local time
  const wd = weekdays[lang][d.getDay()]
  return lang === 'pt' ? `${wd} ${day.slice(8)}/${day.slice(5, 7)}` : `${wd} ${months[d.getMonth()]} ${d.getDate()}`
}
// --- end #5
