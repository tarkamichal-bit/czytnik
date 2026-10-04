import AsyncStorage from '@react-native-async-storage/async-storage';
import Reader, { Box, OcrWord, SavedPage } from '../modules/reader-mlkit/src/ReaderMlkitModule';
import { Engine, langName } from './shared';
import { ModelId } from './pricing';

// A speech bubble or caption, and the panel ("scene") it belongs to.
export type Bubble = { text: string; translation: string; box: Box; words: OcrWord[] };
export type Scene = { box: Box; bubbles: Bubble[] };
export type PageAnalysis = { version?: number; target: string; engine: Engine; lang: string; scenes: Scene[]; note?: string };
/** Bump when the analysis changes, so pages read by an older version are analysed again. */
export const ANALYSIS_VERSION = 4;
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

const area = (b: Box) => b.width * b.height;
function union(boxes: Box[]): Box {
  const x0 = Math.min(...boxes.map((b) => b.left)), y0 = Math.min(...boxes.map((b) => b.top));
  const x1 = Math.max(...boxes.map((b) => b.left + b.width)), y1 = Math.max(...boxes.map((b) => b.top + b.height));
  return { left: x0, top: y0, width: x1 - x0, height: y1 - y0 };
}
/** Consecutive bubbles (in reading order) stay together while their joint box is small. */
function groupNear(items: Bubble[], maxArea: number): Bubble[][] {
  const out: Bubble[][] = [];
  for (const b of items) {
    const g = out[out.length - 1];
    if (g && area(union([...g, b].map((x) => x.box))) <= maxArea) g.push(b);
    else out.push([b]);
  }
  return out;
}
/** Some artwork around a group of bubbles, kept inside the panel; at least about a third of the page wide. */
function frameAround(b: Box, within: Box, page: Box): Box {
  const w = Math.min(within.width, Math.max(page.width * 0.35, b.width * 1.8));
  const h = Math.min(within.height, Math.max(w * 0.75, b.height * 2.4));
  const c = center(b);
  const left = Math.max(within.left, Math.min(within.left + within.width - w, c.x - w / 2));
  const top = Math.max(within.top, Math.min(within.top + within.height - h, c.y - h / 2));
  return { left, top, width: w, height: h };
}

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
  model: ModelId;
  apiKey: string;
  target: string;
  onBusy: (msg: string) => void;
  addUsage: (inTok: number, outTok: number, cost: number) => void;
  /** the photo was straightened into a new file (the original app-owned file is gone) */
  onPage?: (page: SavedPage) => void;
};

// "12", "- 12 -", "str. 12", "12/48": page numbers and similar lone numbers
const PAGE_NO = /^[\s\-–—.·•|]*(?:(?:str|s|p|page|pag|seite|S)\.?\s*)?\d{1,4}(?:\s*\/\s*\d{1,4})?[\s\-–—.·•|]*$/i;

function isPageNumber(b: Bubble, panels: Box[], page: SavedPage) {
  if (!PAGE_NO.test(b.text)) return false;
  const c = center(b.box);
  const nearEdge = c.y < page.height * 0.1 || c.y > page.height * 0.9 || c.x < page.width * 0.08 || c.x > page.width * 0.92;
  if (panels.length < 2) return nearEdge;
  return nearEdge || !panels.some((p) => contains(p, c));
}

function nearestPanel(panels: Box[], b: Box) {
  const c = center(b);
  let idx = panels.findIndex((p) => contains(p, c));
  if (idx >= 0) return idx;
  // outside every panel (caption on the gutter): nearest panel
  let best = Infinity;
  panels.forEach((p, i) => {
    const pc = center(p);
    const d = (pc.x - c.x) ** 2 + (pc.y - c.y) ** 2;
    if (d < best) { best = d; idx = i; }
  });
  return idx;
}

/** Reads a page; a tilted photo is straightened first, so the returned page may be a new file. */
export async function analyzePage(original: SavedPage, o: Analyze): Promise<{ analysis: PageAnalysis; page: SavedPage }> {
  o.onBusy('Prostuję zdjęcie strony…');
  let page: SavedPage = original;
  try {
    const st = await Reader.straighten(original.uri);
    page = { uri: st.uri, width: st.width, height: st.height };
    if (st.uri !== original.uri) o.onPage?.(page);
  } catch {}
  o.onBusy('Szukam kadrów i dymków…');
  const ocr = await Reader.recognize(page.uri);
  // bubbles may be drawn across gutters: the cutter treats them as paper
  const panels = await Reader.detectPanels(page.uri, ocr.blocks.flatMap((b) => [b.left, b.top, b.width, b.height]));
  let bubbles: Bubble[] = ocr.blocks.map((b) => ({ text: b.text, translation: b.text, box: b, words: b.words }));
  bubbles = bubbles.filter((b) => !isPageNumber(b, panels, page));
  let lang = o.target;
  let engine: Engine = 'phone';
  let note: string | undefined;
  // reading order decided by Claude (indices into bubbles), when it ran
  let order: number[] | null = null;

  if (o.engine === 'claude' && o.apiKey && bubbles.length) {
    o.onBusy('Claude czyta dymki i ustala kolejność…');
    let claude: typeof import('./claude') | null = null;
    try {
      claude = require('./claude') as typeof import('./claude');
      const img = await Reader.cropToFrame(page.uri, page.width, page.height, 0, 0, page.width, page.height, 1568);
      const pos = bubbles.map((b) => {
        const c = center(b.box);
        return { text: b.text, x: Math.round((c.x / page.width) * 1000), y: Math.round((c.y / page.height) * 1000) };
      });
      const c = await claude.readComicWithClaude(o.model, o.apiKey, img.base64 ?? '', pos, o.target, langName(o.target));
      o.addUsage(c.inputTokens, c.outputTokens, c.costUsd);
      if (c.blocks.length === bubbles.length) {
        const skip = new Set(c.blocks.flatMap((b, i) => (b.kind === 'page_number' || b.kind === 'other' || !b.text ? [i] : [])));
        bubbles = bubbles.map((b, i) => ({ ...b, text: skip.has(i) ? '' : c.blocks[i].text, translation: c.blocks[i].translation || c.blocks[i].text }));
        const ord = c.order.filter((i) => !skip.has(i));
        // bubbles Claude forgot to order go after the ones it ordered
        bubbles.forEach((_, i) => { if (!skip.has(i) && !ord.includes(i)) ord.push(i); });
        order = ord;
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

  let scenes: Scene[];
  if (panels.length > 1) {
    // a panel is read completely before the next one (panels in reading order from the cutter);
    // inside a panel the bubbles follow Claude's order, or top-to-bottom / left-to-right
    const rank = new Map<Bubble, number>();
    order?.forEach((i, k) => { if (bubbles[i]) rank.set(bubbles[i], k); });
    const groups: Bubble[][] = panels.map(() => []);
    for (const b of bubbles) if (b.text.trim() && (!order || rank.has(b))) groups[nearestPanel(panels, b.box)].push(b);
    scenes = panels.map((p, i) => ({
      box: p,
      bubbles: order ? groups[i].sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0)) : readingOrder(groups[i]),
    }));
    // a "panel" over a large part of the page with bubbles far apart is most likely several panels that
    // could not be separated: then nearby bubbles are shown together, each group zoomed in on its own
    const all = union(panels);
    scenes = scenes.flatMap((sc) => {
      if (sc.bubbles.length < 2 || area(sc.box) < area(all) * 0.45) return [sc];
      return groupNear(sc.bubbles, area(all) * 0.12).map((g) => ({ box: frameAround(union(g.map((b) => b.box)), sc.box, all), bubbles: g }));
    });
  } else {
    // no panel grid found: nearby bubbles together, framed with some surrounding artwork
    const whole = { left: 0, top: 0, width: page.width, height: page.height };
    const live = bubbles.filter((b) => b.text.trim());
    const ordered = order ? order.map((i) => bubbles[i]).filter((b) => b && b.text.trim()) : readingOrder(live);
    scenes = groupNear(ordered, area(whole) * 0.12).map((g) => ({ box: frameAround(union(g.map((b) => b.box)), whole, whole), bubbles: g }));
    if (!scenes.length) scenes = [{ box: whole, bubbles: [] }];
  }
  return { analysis: { version: ANALYSIS_VERSION, target: o.target, engine, lang, scenes, note }, page };
}
