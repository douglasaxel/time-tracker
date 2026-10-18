// Interface strings per language. Pure; detecting the language needs `$`, so it lives in register.ts.
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
    pause: '⏸ Pausar',
    resume: '▶ Retomar',
    paused: 'Em pausa: esta sessão não está contando tempo.',
  },
} satisfies Record<Lang, Record<string, string>>
