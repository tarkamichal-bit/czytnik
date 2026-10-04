// ---------- languages ----------
export const LANGS: Record<string, string> = {
  pl: 'polski', en: 'angielski', de: 'niemiecki', uk: 'ukraiński', fr: 'francuski', es: 'hiszpański',
  it: 'włoski', cs: 'czeski', sk: 'słowacki', ru: 'rosyjski', pt: 'portugalski', nl: 'niderlandzki',
  sv: 'szwedzki', da: 'duński', no: 'norweski', fi: 'fiński', hu: 'węgierski', ro: 'rumuński',
  lt: 'litewski', lv: 'łotewski', hr: 'chorwacki', tr: 'turecki', el: 'grecki', be: 'białoruski',
};
export const TARGETS = ['pl', 'en', 'de', 'uk', 'fr', 'es', 'it'];
export const VOICE_TAG: Record<string, string> = {
  pl: 'pl-PL', en: 'en-US', de: 'de-DE', uk: 'uk-UA', fr: 'fr-FR', es: 'es-ES', it: 'it-IT',
};
export const langName = (c: string) => LANGS[c] ?? (c || 'nieznany');
export const voiceTag = (c: string) => VOICE_TAG[c] ?? c;

// ---------- theme ----------
export const THEMES = {
  normal: {
    bg: '#f5f3ee', surface: 'rgba(255,255,255,0.92)', ink: '#14213d', muted: '#4a5470', line: '#d9d5ca',
    lens: '#ffd23f', lensInk: '#14213d', hl: '#ffe98a', ok: '#18794e', warn: '#a14a00', bar: 'dark' as const,
  },
  contrast: {
    bg: '#000000', surface: '#000000', ink: '#ffe600', muted: '#fff3a0', line: '#ffe600',
    lens: '#ffe600', lensInk: '#000000', hl: '#4a4300', ok: '#7dff9b', warn: '#ffb070', bar: 'light' as const,
  },
};
export type Theme = (typeof THEMES)[keyof typeof THEMES];

export const FONT = 'AtkinsonHyperlegible_400Regular';
export const FONT_BOLD = 'AtkinsonHyperlegible_700Bold';


// ---------- settings ----------
export type Engine = 'phone' | 'claude';
export type VoiceStyle = 'normal' | 'teller' | 'elf' | 'giant';
export type Settings = { target: string; rate: number; autoRead: boolean; contrast: boolean; size: number; engine: Engine; voice: VoiceStyle; comicVoice: VoiceStyle };
export const DEFAULTS: Settings = { target: 'pl', rate: 0.9, autoRead: true, contrast: false, size: 28, engine: 'phone', voice: 'normal', comicVoice: 'elf' };
// Fairy-tale voices are the system voice with a changed pitch (Android: 0.5-2.0) and tempo
export const VOICES: { v: VoiceStyle; label: string; pitch: number; rateMul: number }[] = [
  { v: 'normal', label: 'Zwykły', pitch: 1.0, rateMul: 1.0 },
  { v: 'teller', label: 'Bajarz (ciepły)', pitch: 1.15, rateMul: 0.95 },
  { v: 'elf', label: 'Skrzat (bajkowy)', pitch: 1.4, rateMul: 1.04 },
  { v: 'giant', label: 'Olbrzym', pitch: 0.55, rateMul: 0.9 },
];
export const voiceOf = (v: VoiceStyle) => VOICES.find((x) => x.v === v) ?? VOICES[0];
export const RATES = [
  { v: 0.7, label: 'Wolno' },
  { v: 0.9, label: 'Spokojnie' },
  { v: 1.0, label: 'Normalnie' },
  { v: 1.2, label: 'Szybko' },
];

export type Usage = { lastIn: number; lastOut: number; lastCost: number; totIn: number; totOut: number; totCost: number; count: number };
export const NO_USAGE: Usage = { lastIn: 0, lastOut: 0, lastCost: 0, totIn: 0, totOut: 0, totCost: 0, count: 0 };


export type Token = { text: string; start: number };
export function tokenize(t: string): Token[] {
  const out: Token[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) out.push({ text: m[0], start: m.index });
  return out;
}
export function tokenAt(tokens: Token[], charIndex: number) {
  let i = 0;
  while (i + 1 < tokens.length && tokens[i + 1].start <= charIndex) i++;
  return i;
}
export function fmtInt(n: number) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}
export function fmtUsd(n: number) {
  return '$' + (n < 1 ? n.toFixed(4) : n.toFixed(2)).replace('.', ',');
}
