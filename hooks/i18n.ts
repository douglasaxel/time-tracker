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
    // Days and filters.
    noTime: 'No time worked in this period.',
    pickHint: 'Press a folder to see its days.',
    viewDays: 'Timesheet',
    viewTree: 'Folders',
    allFolders: 'All folders',
    correct: 'Correct hours',
    realTime: 'Real time',
    readFailed: "Could not read the other sessions' hours:",
    effortTime: 'With subagents',
    pickStart: 'Pick the first day, or press the month to see all of it.',
    pickEnd: 'Now pick the last day.',
    close: 'Close',
    before: 'before',
    to: 'to',
    // Manual pause.
    pause: '⏸ Pause',
    resume: '▶ Resume',
    paused: 'Paused: this session is not counting time.',
    // Corrections.
    adjust: 'Add or subtract',
    adjustHint: '+15 or -30 min',
    deleteDay: 'Delete this day',
    corrected: '* corrected by hand',
    // Copy as Markdown.
    copy: 'Copy as Markdown',
    copied: 'Copied. Paste it into your hours report.',
    copyFailed: 'The clipboard did not take it. Select the table below and copy it.',
    colDate: 'Date',
    colProject: 'Project',
    colHours: 'Hours',
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
    pickHint: 'Pressione uma pasta para ver os dias dela.',
    viewDays: 'Folha de ponto',
    viewTree: 'Pastas',
    allFolders: 'Todas as pastas',
    correct: 'Corrigir horas',
    realTime: 'Tempo real',
    readFailed: 'Não consegui ler as horas das outras sessões:',
    effortTime: 'Com subagentes',
    pickStart: 'Escolha o primeiro dia, ou pressione o mês para ver ele inteiro.',
    pickEnd: 'Agora escolha o último dia.',
    close: 'Fechar',
    before: 'antes',
    to: 'a',
    pause: '⏸ Pausar',
    resume: '▶ Retomar',
    paused: 'Em pausa: esta sessão não está contando tempo.',
    adjust: 'Somar ou subtrair',
    adjustHint: '+15 ou -30 min',
    deleteDay: 'Apagar este dia',
    corrected: '* corrigido à mão',
    copy: 'Copiar como Markdown',
    copied: 'Copiado. Cole no relatório de horas.',
    copyFailed: 'A área de transferência não aceitou. Selecione a tabela abaixo e copie.',
    colDate: 'Data',
    colProject: 'Projeto',
    colHours: 'Horas',
  },
} satisfies Record<Lang, Record<string, string>>

export const filters: Record<Lang, Record<Filter, string>> = {
  en: { today: 'Today', week: 'Week', month: 'Month', all: 'All', custom: 'Dates' },
  pt: { today: 'Hoje', week: 'Semana', month: 'Mês', all: 'Tudo', custom: 'Datas' },
}

const weekdays = { en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], pt: ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'] }
const monthNames = {
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  pt: ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'],
}

/** A month (`YYYY-MM`) as the calendar titles it: `outubro de 2026` or `October 2026`. */
export const monthTitle = (month: string, lang: Lang) =>
  `${monthNames[lang][Number(month.slice(5)) - 1]}${lang === 'pt' ? ' de' : ''} ${month.slice(0, 4)}`

/** The weekdays as the calendar's columns name them, Monday first. */
export const weekHeads = (lang: Lang) => [...weekdays[lang].slice(1), weekdays[lang][0] ?? '']

const months = monthNames.en.map(name => name.slice(0, 3))

/** A day key's weekday: 0 is Sunday, 1 is Monday. */
export const weekday = (day: string) => new Date(`${day}T00:00`).getDay()

/** A day key as a row reads it: `seg 12/10` or `Mon Oct 12`; with the year, `seg 12/10/2026` or `Mon Oct 12, 2026`. */
export function dayLabel(day: string, lang: Lang, withYear = false): string {
  const d = new Date(`${day}T00:00`) // no offset: local time
  const wd = weekdays[lang][d.getDay()]
  const year = day.slice(0, 4)
  if (lang === 'pt') return `${wd} ${day.slice(8)}/${day.slice(5, 7)}${withYear ? `/${year}` : ''}`
  return `${wd} ${months[d.getMonth()]} ${d.getDate()}${withYear ? `, ${year}` : ''}`
}
