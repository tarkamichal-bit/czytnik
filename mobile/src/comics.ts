import AsyncStorage from '@react-native-async-storage/async-storage';
import Reader, { Box, OcrWord, SavedPage } from '../modules/reader-mlkit/src/ReaderMlkitModule';
import { Engine, langName } from './shared';

// A speech bubble or caption, and the panel ("scene") it belongs to.
export type Bubble = { text: string; translation: string; box: Box; words: OcrWord[] };
export type Scene = { box: Box; bubbles: Bubble[] };
export type PageAnalysis = { target: string; engine: Engine; lang: string; scenes: Scene[]; note?: string };
export type ComicPage = SavedPage & { analysis?: PageAnalysis };
export type Comic = { id: string; title: string; createdAt: number; pages: ComicPage[] };

const KEY = 'czytnik.comics';

export async function loadComics(): Promise<Comic[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Comic[]) : [];
  } catch {
    return [];
  }
}
export async function saveComics(list: Comic[]) {
  try { await AsyncStorage.setItem(KEY, JSON.stringify(list)); } catch {}
}

const center = (b: Box) => ({ x: b.left + b.width / 2, y: b.top + b.height / 2 });
const contains = (b: Box, p: { x: number; y: number }) => p.x >= b.left && p.x <= b.left + b.width && p.y >= b.top && p.y <= b.top + b.height;

// Bubbles of one panel in reading order: rows top to bottom, left to right inside a row.
function readingOrder<T extends { box: Box }>(items: T[]): T[] {
  const sorted = [...items].sort((a, b) => a.box.top - b.box.top);
  const rows: T[][] = [];
  for (const it of sorted) {
    const row = rows[rows.length - 1];
    if (row && it.box.top < row[0].box.top + row[0].box.height * 0.5) row.push(it);
    else rows.push([it]);
  }
  return rows.flatMap((r) => r.sort((a, b) => a.box.left - b.box.left));
}

type Analyze = {
  engine: Engine;
  apiKey: string;
  target: string;
  onBusy: (msg: string) => void;
  addUsage: (inTok: number, outTok: number, cost: number) => void;
};

export async function analyzePage(page: SavedPage, o: Analyze): Promise<PageAnalysis> {
  o.onBusy('Szukam kadrów i dymków…');
  const [panels, ocr] = await Promise.all([Reader.detectPanels(page.uri), Reader.recognize(page.uri)]);
  let bubbles: Bubble[] = ocr.blocks.map((b) => ({ text: b.text, translation: b.text, box: b, words: b.words }));
  let lang = o.target;
  let engine: Engine = 'phone';
  let note: string | undefined;

  if (o.engine === 'claude' && o.apiKey && bubbles.length) {
    o.onBusy('Claude poprawia tekst w dymkach…');
    let claude: typeof import('./claude') | null = null;
    try {
      claude = require('./claude') as typeof import('./claude');
      const img = await Reader.cropToFrame(page.uri, page.width, page.height, 0, 0, page.width, page.height, 1568);
      const c = await claude.readWithClaude(o.apiKey, img.base64 ?? '', bubbles.map((b) => b.text), o.target, langName(o.target));
      o.addUsage(c.inputTokens, c.outputTokens, c.costUsd);
      if (c.blocks.length === bubbles.length) {
        bubbles = bubbles.map((b, i) => ({ ...b, text: c.blocks[i].text, translation: c.blocks[i].translation || c.blocks[i].text }));
        lang = c.lang || o.target;
        engine = 'claude';
      } else {
        note = 'Claude podzielił tekst inaczej; używam rozpoznawania z telefonu.';
      }
    } catch (e) {
      note = (claude ? claude.describeClaudeError(e) : 'Claude niedostępny.') + ' Używam rozpoznawania z telefonu.';
    }
  }

  if (engine === 'phone' && bubbles.length) {
    try { lang = (await Reader.identifyLanguage(bubbles.map((b) => b.text).join('\n'))).split('-')[0]; } catch {}
    if (lang === 'und') lang = o.target;
    if (lang !== o.target) {
      o.onBusy(`Tłumaczę z języka: ${langName(lang)}…`);
      try {
        const out: Bubble[] = [];
        for (const b of bubbles) out.push({ ...b, translation: await Reader.translate(b.text, lang, o.target) });
        bubbles = out;
      } catch {
        note = 'Tłumaczenie niedostępne (brak internetu przy pierwszym użyciu?)';
      }
    }
  }
  bubbles = bubbles.filter((b) => b.text.trim());

  let scenes: Scene[];
  if (panels.length > 1) {
    const groups: Bubble[][] = panels.map(() => []);
    for (const b of bubbles) {
      const c = center(b.box);
      let idx = panels.findIndex((p) => contains(p, c));
      if (idx < 0) {
        // outside every panel (caption on the gutter): nearest panel
        let best = Infinity;
        panels.forEach((p, i) => {
          const pc = center(p);
          const d = (pc.x - c.x) ** 2 + (pc.y - c.y) ** 2;
          if (d < best) { best = d; idx = i; }
        });
      }
      groups[idx].push(b);
    }
    scenes = panels.map((p, i) => ({ box: p, bubbles: readingOrder(groups[i]) }));
  } else {
    // no panel grid found: one scene per bubble, framed with some surrounding artwork
    const minW = page.width * 0.35;
    scenes = readingOrder(bubbles).map((b) => {
      const w = Math.max(minW, b.box.width * 2.2);
      const h = Math.max(minW * 0.75, b.box.height * 3);
      const c = center(b.box);
      const left = Math.max(0, Math.min(page.width - w, c.x - w / 2));
      const top = Math.max(0, Math.min(page.height - h, c.y - h / 2));
      return { box: { left, top, width: Math.min(w, page.width), height: Math.min(h, page.height) }, bubbles: [b] };
    });
    if (!scenes.length) scenes = [{ box: { left: 0, top: 0, width: page.width, height: page.height }, bubbles: [] }];
  }
  return { target: o.target, engine, lang, scenes, note };
}
