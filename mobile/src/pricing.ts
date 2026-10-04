// Claude models the app can use. USD per 1M tokens, Anthropic first-party API.
export type ModelId = 'claude-sonnet-5-5' | 'claude-opus-5-5';
export const MODELS: { id: ModelId; label: string; in: number; out: number }[] = [
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5 (tańszy)', in: 2, out: 10 },
  { id: 'claude-opus-5-5', label: 'Opus 5.5 (najdokładniejszy)', in: 4, out: 20 },
];
export const DEFAULT_MODEL: ModelId = 'claude-sonnet-5-5';
export const modelOf = (id: string) => MODELS.find((m) => m.id === id) ?? MODELS[0];
