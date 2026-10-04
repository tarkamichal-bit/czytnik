import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import * as z from 'zod/v4';

import { CLAUDE_MODEL, PRICE_IN, PRICE_OUT } from './pricing';

const ReadingSchema = z.object({
  lang: z.string(),
  blocks: z.array(z.object({ text: z.string(), translation: z.string() })),
});

export type ClaudeReading = {
  lang: string;
  blocks: { text: string; translation: string }[];
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
};

export class ClaudeRefusal extends Error {}

export function costOf(inputTokens: number, outputTokens: number) {
  return (inputTokens * PRICE_IN + outputTokens * PRICE_OUT) / 1_000_000;
}

export async function readWithClaude(
  apiKey: string,
  jpegBase64: string,
  ocrBlocks: string[],
  target: string,
  targetName: string,
  opts: { careful?: boolean } = {},
): Promise<ClaudeReading> {
  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 180_000 });
  const ocrList = ocrBlocks.length
    ? ocrBlocks.map((t, i) => `[${i}] ${t}`).join('\n')
    : '(brak – automatyczne rozpoznawanie nic nie znalazło)';
  const prompt =
    `Zdjęcie przedstawia tekst (etykieta, ulotka, list, książka, komiks, ekran). ` +
    `Automatyczne rozpoznawanie podzieliło go na fragmenty (akapity lub dymki), ale myli znaki, zwłaszcza polskie litery:\n` +
    `${ocrList}\n\n` +
    `Zadanie: patrząc na zdjęcie, popraw każdy fragment, tak aby dokładnie odpowiadał temu, co jest na zdjęciu ` +
    `(poprawne znaki diakrytyczne, np. ą ć ę ł ń ó ś ź ż; słowa przeniesione do następnej linii połączone). ` +
    `Zwróć w "blocks" dokładnie ${ocrBlocks.length || 'tyle, ile jest akapitów lub dymków na zdjęciu'} ` +
    `${ocrBlocks.length ? 'elementów, w tej samej kolejności co lista powyżej' : 'elementów, w kolejności czytania'}. ` +
    `Fragment będący szumem (pojedyncze znaki z tła, kod kreskowy) zwróć jako pusty tekst. ` +
    `W "lang" podaj kod ISO 639-1 głównego języka tekstu. ` +
    `Jeśli ten język jest inny niż "${target}" (${targetName}), w "translation" każdego fragmentu podaj naturalne tłumaczenie ` +
    `na ${targetName} do odczytania przez lektora; jeśli jest taki sam, "translation" ma być identyczne z "text".` +
    (opts.careful
      ? `\n\nTo zdjęcie zrobiła starsza osoba: tekst bywa bardzo drobny, nieostry lub pod kątem (instrukcja obsługi, ulotka leku, ` +
        `pismo urzędowe, artykuł z gazety). Przyjrzyj się uważnie i odczytaj niewyraźne słowa z kontekstu zdania i rodzaju dokumentu. ` +
        `Liczby, dawki, jednostki, daty, nazwy własne i ostrzeżenia przepisz i przetłumacz bezbłędnie, bez skracania i upraszczania. ` +
        `Tłumacz wiernie, rzeczowym, pełnym językiem. Jeśli fragmentu nie da się odczytać nawet z kontekstu, wstaw w jego miejscu „[nieczytelne]”, ` +
        `zamiast zgadywać liczby lub dawki.`
      : '');

  const msg = await client.beta.messages.parse({
    model: CLAUDE_MODEL,
    max_tokens: opts.careful ? 16000 : 8000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: opts.careful ? 'high' : 'low', format: betaZodOutputFormat(ReadingSchema) },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpegBase64 } },
          { type: 'text', text: prompt },
        ],
      },
    ],
  });

  const u = msg.usage;
  const inputTokens = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
  const outputTokens = u.output_tokens ?? 0;
  if (msg.stop_reason === 'refusal') throw new ClaudeRefusal('refusal');
  const out = msg.parsed_output;
  if (!out) throw new Error('no parsed output');
  return {
    lang: out.lang.trim().toLowerCase().slice(0, 2),
    blocks: out.blocks.map((b) => ({ text: b.text.trim(), translation: b.translation.trim() })),
    inputTokens,
    outputTokens,
    costUsd: costOf(inputTokens, outputTokens),
  };
}

export function describeClaudeError(e: unknown): string {
  if (e instanceof ClaudeRefusal) return 'Claude odmówił odczytania tego zdjęcia.';
  if (e instanceof Anthropic.AuthenticationError) return 'Nieprawidłowy klucz API Claude. Sprawdź go w Ustawieniach.';
  if (e instanceof Anthropic.PermissionDeniedError) return 'Klucz API nie ma dostępu do tego modelu.';
  if (e instanceof Anthropic.RateLimitError) return 'Za dużo zapytań do Claude. Spróbuj za chwilę.';
  if (e instanceof Anthropic.BadRequestError) return 'Claude odrzucił zapytanie (np. brak środków na koncie API).';
  if (e instanceof Anthropic.APIConnectionError) return 'Brak połączenia z Claude. Sprawdź internet.';
  if (e instanceof Anthropic.APIError) return `Błąd Claude (${e.status ?? '?'}).`;
  return 'Nie udało się odczytać tekstu przez Claude.';
}
