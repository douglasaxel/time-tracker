// Interface strings per language. Pure; detecting the language needs `$`, so it lives in register.ts.
export type Lang = 'en' | 'pt'

export const isPortuguese = (v: unknown): boolean => typeof v === 'string' && /^(pt|portugu)/i.test(v.trim())

export const strings = {
  en: { today: 'today' },
  pt: { today: 'hoje' },
} satisfies Record<Lang, Record<string, string>>
