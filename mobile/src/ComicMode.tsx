import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, LayoutChangeEvent, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { CameraView } from 'expo-camera';
import * as Speech from 'expo-speech';
import Reader, { Box, SavedPage } from '../modules/reader-mlkit/src/ReaderMlkitModule';
import Eraser from './Eraser';
import { ANALYSIS_VERSION, Comic, PageAnalysis, analyzePage, loadComics, saveComics } from './comics';
import { FONT, FONT_BOLD, Settings, Theme, langName, tokenAt, tokenize, voiceOf, voiceTag } from './shared';
import { BigButton, BusyOverlay, Chip, S } from './ui';

type Props = {
  s: S;
  t: Theme;
  settings: Settings;
  apiKey: string;
  addUsage: (inTok: number, outTok: number, cost: number) => void;
  bottomInset: number;
};

type Screen = { kind: 'list' } | { kind: 'capture'; comicId: string; firstNew: number } | { kind: 'read'; comicId: string; page: number };
type Cursor = { scene: number; bubble: number | null; token: number | null };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export default function ComicMode({ s, t, settings, apiKey, addUsage, bottomInset }: Props) {
  const c = styles(t);
  const [comics, setComics] = useState<Comic[]>([]);
  const [screen, setScreen] = useState<Screen>({ kind: 'list' });
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [torch, setTorch] = useState(false);
  const [analysis, setAnalysis] = useState<PageAnalysis | null>(null);
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const [playing, setPlaying] = useState(false);
  const [pageDone, setPageDone] = useState(false);
  const [view, setView] = useState<'tr' | 'or'>('tr');
  const [size, setSize] = useState({ w: 0, h: 0 });
  const cameraRef = useRef<CameraView>(null);
  const playToken = useRef(0);
  const zoom = useRef(new Animated.Value(1)).current;
  const tx = useRef(new Animated.Value(0)).current;
  const ty = useRef(new Animated.Value(0)).current;

  useEffect(() => { loadComics().then(setComics); }, []);
  useEffect(() => () => { playToken.current++; Speech.stop(); }, []);

  const persist = useCallback((next: Comic[]) => { setComics(next); saveComics(next); }, []);
  const comic = screen.kind !== 'list' ? comics.find((x) => x.id === screen.comicId) ?? null : null;
  const page = screen.kind === 'read' && comic ? comic.pages[screen.page] : null;
  const translated = !!analysis && analysis.scenes.some((sc) => sc.bubbles.some((b) => b.translation && b.translation !== b.text));
  const voice = voiceOf(settings.comicVoice);

  // ---------- list ----------
  const newComic = () => {
    const id = Date.now().toString(36);
    const next = [...comics, { id, title: `Komiks ${comics.length + 1}`, createdAt: Date.now(), pages: [] }];
    persist(next);
    setScreen({ kind: 'capture', comicId: id, firstNew: 0 });
  };
  const deleteComic = async (id: string) => {
    if (confirmDelete !== id) { setConfirmDelete(id); return; }
    setConfirmDelete(null);
    try { await Reader.deleteComic(id); } catch {}
    persist(comics.filter((x) => x.id !== id));
  };

  // ---------- eraser ----------
  const [erasing, setErasing] = useState<{ comicId: string; page: number; img: SavedPage } | null>(null);
  const editPage = (comicId: string, idx: number) => {
    const p = comics.find((x) => x.id === comicId)?.pages[idx];
    if (!p) return;
    stop();
    setErasing({ comicId, page: idx, img: { uri: p.uri, width: p.width, height: p.height } });
  };
  const afterErase = (img: SavedPage) => {
    if (!erasing) return;
    const { comicId, page: idx } = erasing;
    setErasing(null);
    // the edited photo replaces the page; its old analysis no longer matches
    setComics((prev) => {
      const next = prev.map((x) => (x.id === comicId ? { ...x, pages: x.pages.map((p, i) => (i === idx ? { ...img } : p)) } : x));
      saveComics(next);
      return next;
    });
  };
  const eraser = <Eraser t={t} image={erasing?.img ?? null} onDone={afterErase} onCancel={() => setErasing(null)} />;

  // ---------- capture ----------
  const shoot = async () => {
    if (!cameraRef.current || busy || !comic) return;
    try {
      setBusy('Zapisuję stronę…');
      const photo = await cameraRef.current.takePictureAsync({ quality: 1 });
      if (!photo?.uri) throw new Error('no photo');
      const saved = await Reader.savePage(photo.uri, comic.id, `p${Date.now().toString(36)}`);
      persist(comics.map((x) => (x.id === comic.id ? { ...x, pages: [...x.pages, saved] } : x)));
    } catch {
      setBusy('Nie udało się zapisać zdjęcia.');
      await sleep(1500);
    } finally {
      setBusy(null);
    }
  };

  // ---------- reader: camera move ----------
  const base = page && size.w ? Math.min(size.w / page.width, size.h / page.height) : 1;
  const focus = useCallback(
    (b: Box) =>
      new Promise<void>((resolve) => {
        if (!page || !size.w) return resolve();
        const bw = b.width * base, bh = b.height * base;
        const z = Math.min(4, Math.min(size.w / bw, size.h / bh) * 0.94);
        const cx = (b.left + b.width / 2) * base, cy = (b.top + b.height / 2) * base;
        Animated.parallel([
          Animated.timing(zoom, { toValue: z, duration: 700, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
          Animated.timing(tx, { toValue: size.w / 2 - z * cx, duration: 700, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
          Animated.timing(ty, { toValue: size.h / 2 - z * cy, duration: 700, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
        ]).start(() => resolve());
      }),
    [page, size, base, zoom, tx, ty],
  );
  const showWholePage = useCallback(() => {
    if (page) focus({ left: 0, top: 0, width: page.width, height: page.height });
  }, [page, focus]);

  // ---------- reader: speech ----------
  const stop = useCallback(() => {
    playToken.current++;
    Speech.stop();
    setPlaying(false);
    setCursor(null);
  }, []);

  const playFrom = useCallback(
    async (a: PageAnalysis, sceneIdx: number, bubbleIdx: number, v: 'tr' | 'or') => {
      playToken.current++;
      const token = playToken.current;
      Speech.stop();
      setPlaying(true);
      setPageDone(false);
      const tr = a.scenes.some((sc) => sc.bubbles.some((b) => b.translation && b.translation !== b.text));
      const lang = v === 'tr' && tr ? settings.target : a.lang || settings.target;
      for (let si = sceneIdx; si < a.scenes.length; si++) {
        const sc = a.scenes[si];
        setCursor({ scene: si, bubble: null, token: null });
        await focus(sc.box);
        if (token !== playToken.current) return;
        if (!sc.bubbles.length) { await sleep(1500); if (token !== playToken.current) return; continue; }
        for (let bi = si === sceneIdx ? bubbleIdx : 0; bi < sc.bubbles.length; bi++) {
          const b = sc.bubbles[bi];
          const text = (v === 'tr' && tr ? b.translation || b.text : b.text).slice(0, 3900);
          const tokens = tokenize(text);
          setCursor({ scene: si, bubble: bi, token: 0 });
          await new Promise<void>((resolve) => {
            Speech.speak(text, {
              language: voiceTag(lang),
              rate: settings.rate * voice.rateMul,
              pitch: voice.pitch,
              onBoundary: (ev: { charIndex?: number }) => {
                if (token === playToken.current && typeof ev?.charIndex === 'number') setCursor({ scene: si, bubble: bi, token: tokenAt(tokens, ev.charIndex) });
              },
              onDone: () => resolve(),
              onStopped: () => resolve(),
              onError: () => resolve(),
            });
          });
          if (token !== playToken.current) return;
          await sleep(350);
        }
      }
      if (token !== playToken.current) return;
      setPlaying(false);
      setCursor(null);
      setPageDone(true);
      showWholePage();
    },
    [settings.target, settings.rate, voice, focus, showWholePage],
  );

  // ---------- reader: load page ----------
  const openPage = useCallback(
    async (comicId: string, idx: number) => {
      stop();
      setPageDone(false);
      setAnalysis(null);
      setScreen({ kind: 'read', comicId, page: idx });
    },
    [stop],
  );

  useEffect(() => {
    if (screen.kind !== 'read' || !comic || !page || !size.w) return;
    let cancelled = false;
    (async () => {
      zoom.setValue(1); tx.setValue(0); ty.setValue(0);
      const wantClaude = settings.engine === 'claude' && !!apiKey;
      let a = page.analysis;
      const usable = a && a.version === ANALYSIS_VERSION && a.target === settings.target && (a.engine === 'claude' || !wantClaude);
      if (!usable) {
        try {
          a = await analyzePage(page, { engine: settings.engine, apiKey, target: settings.target, onBusy: setBusy, addUsage });
        } catch {
          a = undefined;
        }
        setBusy(null);
        if (cancelled) return;
        if (!a) { setBusy('Nie udało się odczytać tej strony.'); await sleep(1500); setBusy(null); return; }
        const pageIdx = screen.page;
        const saved = a;
        setComics((prev) => {
          const next = prev.map((x) => (x.id === comic.id ? { ...x, pages: x.pages.map((p, i) => (i === pageIdx ? { ...p, analysis: saved } : p)) } : x));
          saveComics(next);
          return next;
        });
      }
      if (cancelled || !a) return;
      setAnalysis(a);
      const tr = a.scenes.some((sc) => sc.bubbles.some((b) => b.translation && b.translation !== b.text));
      const v = tr ? 'tr' : 'or';
      setView(v);
      if (settings.autoRead) playFrom(a, 0, 0, v);
    })();
    return () => { cancelled = true; };
    // run when the page (or the viewer size) changes, not on every analysis save
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen.kind === 'read' ? `${screen.comicId}:${screen.page}:${page?.uri ?? ''}` : '', size.w > 0]);

  const onLayout = (e: LayoutChangeEvent) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });

  // ---------- render: list ----------
  if (screen.kind === 'list') {
    return (
      <View style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={c.listWrap}>
          <Text style={c.lead}>Zrób zdjęcia stron komiksu, a lektor przeczyta go kadr po kadrze.</Text>
          {comics.map((x) => (
            <View key={x.id} style={c.card}>
              {x.pages[0] ? <Image source={{ uri: x.pages[0].uri }} style={c.thumb} /> : <View style={[c.thumb, c.thumbEmpty]} />}
              <View style={c.cardBody}>
                <Text style={c.cardTitle}>{x.title}</Text>
                <Text style={c.cardMeta}>{x.pages.length} {x.pages.length === 1 ? 'strona' : x.pages.length < 5 && x.pages.length > 1 ? 'strony' : 'stron'}</Text>
                <View style={c.cardBtns}>
                  {x.pages.length > 0 && (
                    <Pressable style={c.btnYellow} onPress={() => openPage(x.id, 0)} accessibilityRole="button">
                      <Text style={c.btnYellowText}>Czytaj</Text>
                    </Pressable>
                  )}
                  <Pressable style={c.btn} onPress={() => setScreen({ kind: 'capture', comicId: x.id, firstNew: x.pages.length })} accessibilityRole="button">
                    <Text style={c.btnText}>Dodaj strony</Text>
                  </Pressable>
                  <Pressable style={[c.btn, confirmDelete === x.id && c.btnDanger]} onPress={() => deleteComic(x.id)} accessibilityRole="button">
                    <Text style={[c.btnText, confirmDelete === x.id && c.btnDangerText]}>{confirmDelete === x.id ? 'Na pewno?' : 'Usuń'}</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          ))}
          {!comics.length && <Text style={c.empty}>Nie masz jeszcze komiksów. Zacznij od pierwszej strony.</Text>}
        </ScrollView>
        <View style={[s.bar, { paddingBottom: bottomInset }]}>
          <BigButton s={s} label="Nowy komiks" onPress={newComic} flex />
        </View>
      </View>
    );
  }

  // ---------- render: capture ----------
  if (screen.kind === 'capture') {
    const n = comic?.pages.length ?? 0;
    return (
      <View style={{ flex: 1 }}>
        {eraser}
        <View style={s.lens}>
          <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" autofocus="on" enableTorch={torch} onCameraReady={() => setCameraReady(true)} />
          <View pointerEvents="none" style={c.pageGuide} />
          {busy && <BusyOverlay s={s} text={busy} t={t} />}
        </View>
        <ScrollView horizontal style={c.strip} contentContainerStyle={c.stripInner}>
          {comic?.pages.map((p, i) => (
            <Pressable key={p.uri} onPress={() => editPage(comic.id, i)} accessibilityRole="button" accessibilityLabel={`Gumka na stronie ${i + 1}`}>
              <Image source={{ uri: p.uri }} style={[c.mini, i >= screen.firstNew && c.miniNew]} />
            </Pressable>
          ))}
          <Text style={c.stripText}>{n ? `Stron: ${n}. Dotknij strony, aby użyć gumki.` : 'Zmieść całą stronę w kadrze.'}</Text>
        </ScrollView>
        <View style={[s.bar, { paddingBottom: bottomInset }]}>
          <Pressable style={[s.big, s.secondary]} onPress={() => setScreen({ kind: 'list' })} accessibilityRole="button">
            <Text style={s.bigText}>Wróć</Text>
          </Pressable>
          <BigButton s={s} label="Zdjęcie strony" onPress={shoot} disabled={!cameraReady || !!busy} flex />
          <Pressable
            style={[s.big, s.secondary, !n && { opacity: 0.4 }]}
            disabled={!n}
            onPress={() => comic && openPage(comic.id, Math.min(screen.firstNew, n - 1))}
            accessibilityRole="button"
          >
            <Text style={s.bigText}>Czytaj</Text>
          </Pressable>
        </View>
        <Pressable onPress={() => setTorch((v) => !v)} style={c.torch} accessibilityRole="switch" accessibilityState={{ checked: torch }}>
          <Text style={c.torchText}>{torch ? 'Latarka wł.' : 'Latarka'}</Text>
        </Pressable>
      </View>
    );
  }

  // ---------- render: reader ----------
  const pages = comic?.pages.length ?? 0;
  const pageIdx = screen.page;
  const sc = cursor && analysis ? analysis.scenes[cursor.scene] : null;
  const bub = sc && cursor && cursor.bubble !== null ? sc.bubbles[cursor.bubble] : null;
  const shown = bub ? (view === 'tr' && translated ? bub.translation || bub.text : bub.text) : '';
  const tokens = tokenize(shown);
  let wordBox: Box | null = null;
  if (bub && cursor && cursor.token !== null && view === 'or' && bub.words.length) {
    const spoken = Math.max(1, tokens.length);
    const idx = spoken === bub.words.length ? cursor.token : Math.round((cursor.token * (bub.words.length - 1)) / Math.max(1, spoken - 1));
    wordBox = bub.words[Math.min(bub.words.length - 1, Math.max(0, idx))];
  }
  const place = (b: Box, pad = 0) => ({ left: b.left * base - pad, top: b.top * base - pad, width: b.width * base + 2 * pad, height: b.height * base + 2 * pad });
  const totalScenes = analysis?.scenes.length ?? 0;
  const textSize = Math.min(settings.size, 30);

  return (
    <View style={{ flex: 1 }}>
      {eraser}
      <View style={[s.lens, c.viewer]} onLayout={onLayout}>
        {page && size.w > 0 && (
          <Animated.View
            style={{
              position: 'absolute', left: 0, top: 0, width: page.width * base, height: page.height * base,
              transformOrigin: 'top left',
              transform: [{ translateX: tx }, { translateY: ty }, { scale: zoom }],
            }}
          >
            <Image source={{ uri: page.uri }} style={StyleSheet.absoluteFill} />
            {analysis?.scenes.map((scn, si) =>
              scn.bubbles.map((b, bi) => (
                <Pressable
                  key={`${si}-${bi}`}
                  onPress={() => analysis && playFrom(analysis, si, bi, view)}
                  style={[c.bubble, place(b.box, 3), cursor?.scene === si && cursor.bubble === bi && c.bubbleNow]}
                  accessibilityRole="button"
                  accessibilityLabel="Czytaj od tego dymka"
                />
              )),
            )}
            {wordBox && <View pointerEvents="none" style={[c.word, place(wordBox, 2)]} />}
          </Animated.View>
        )}
        {busy && <BusyOverlay s={s} text={busy} t={t} />}
      </View>

      <View style={c.info}>
        <Chip s={s} text={`Strona ${pageIdx + 1}/${pages}`} color={t.muted} />
        {comic && (
          <Pressable onPress={() => editPage(comic.id, pageIdx)} style={c.switch} accessibilityRole="button" accessibilityLabel="Gumka: zamaż część strony, której nie trzeba czytać">
            <Text style={c.switchText}>Gumka</Text>
          </Pressable>
        )}
        {totalScenes > 0 && <Chip s={s} text={`Kadr ${(cursor?.scene ?? 0) + 1}/${totalScenes}`} color={t.muted} />}
        {analysis && analysis.lang !== settings.target && <Chip s={s} text={`${langName(analysis.lang)} → ${langName(settings.target)}`} color={t.ok} />}
        {translated && (
          <Pressable onPress={() => { stop(); setView(view === 'tr' ? 'or' : 'tr'); }} style={c.switch} accessibilityRole="button">
            <Text style={c.switchText}>{view === 'tr' ? 'Pokaż oryginał' : 'Pokaż tłumaczenie'}</Text>
          </Pressable>
        )}
        {analysis?.note ? <Chip s={s} text={analysis.note} color={t.warn} /> : null}
      </View>
      <View style={c.textBox}>
        <Text style={[c.text, { fontSize: textSize, lineHeight: textSize * 1.4 }]} numberOfLines={4}>
          {bub
            ? tokens.map((tk, i) => (
                <Text key={i} style={cursor?.token === i ? s.now : undefined}>{tk.text}{i < tokens.length - 1 ? ' ' : ''}</Text>
              ))
            : pageDone
              ? 'Koniec strony.'
              : analysis && !totalScenes ? 'Na tej stronie nie znalazłem tekstu.' : ' '}
        </Text>
      </View>

      <View style={[s.bar, { paddingBottom: bottomInset }]}>
        <Pressable
          style={[s.big, s.secondary, c.smallBig]}
          onPress={() => (pageIdx > 0 && comic ? openPage(comic.id, pageIdx - 1) : (stop(), setScreen({ kind: 'list' })))}
          accessibilityRole="button"
          accessibilityLabel={pageIdx > 0 ? 'Poprzednia strona' : 'Wróć do listy'}
        >
          <Text style={s.bigText}>{pageIdx > 0 ? '◀' : 'Lista'}</Text>
        </Pressable>
        <Pressable
          style={[s.big, s.secondary, { flex: 1 }, playing && s.pressed]}
          onPress={() => (playing ? stop() : analysis && playFrom(analysis, pageDone ? 0 : cursor?.scene ?? 0, 0, view))}
          disabled={!analysis}
          accessibilityRole="button"
        >
          <Text style={[s.bigText, playing && s.pressedText]}>{playing ? 'Stop' : pageDone ? 'Jeszcze raz' : 'Czytaj'}</Text>
        </Pressable>
        <Pressable
          style={[s.big, { flex: 1.3 }, !pageDone && s.secondary, pageIdx >= pages - 1 && !pageDone && { opacity: 0.5 }]}
          onPress={() => {
            if (!comic) return;
            if (pageIdx < pages - 1) openPage(comic.id, pageIdx + 1);
            else { stop(); setScreen({ kind: 'capture', comicId: comic.id, firstNew: pages }); }
          }}
          accessibilityRole="button"
        >
          <Text style={s.bigText}>{pageIdx < pages - 1 ? 'Następna\nstrona' : 'Dodaj\nstronę'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function styles(t: Theme) {
  return StyleSheet.create({
    listWrap: { padding: 16, gap: 12 },
    lead: { fontFamily: FONT, fontSize: 19, color: t.muted },
    empty: { fontFamily: FONT, fontSize: 20, color: t.muted, textAlign: 'center', marginTop: 24 },
    card: { flexDirection: 'row', gap: 12, padding: 12, borderRadius: 18, borderWidth: 2, borderColor: t.line, backgroundColor: t.surface },
    thumb: { width: 84, height: 112, borderRadius: 10, backgroundColor: '#ddd' },
    thumbEmpty: { borderWidth: 2, borderStyle: 'dashed', borderColor: t.line, backgroundColor: 'transparent' },
    cardBody: { flex: 1, gap: 6, minWidth: 0 },
    cardTitle: { fontFamily: FONT_BOLD, fontSize: 22, color: t.ink },
    cardMeta: { fontFamily: FONT, fontSize: 17, color: t.muted },
    cardBtns: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    btn: { minHeight: 48, paddingHorizontal: 14, borderRadius: 12, borderWidth: 2, borderColor: t.line, backgroundColor: t.surface, justifyContent: 'center' },
    btnText: { fontFamily: FONT_BOLD, fontSize: 17, color: t.ink },
    btnYellow: { minHeight: 48, paddingHorizontal: 18, borderRadius: 12, borderWidth: 2, borderColor: t.ink, backgroundColor: t.lens, justifyContent: 'center' },
    btnYellowText: { fontFamily: FONT_BOLD, fontSize: 17, color: t.lensInk },
    btnDanger: { borderColor: t.warn },
    btnDangerText: { color: t.warn },
    pageGuide: { position: 'absolute', left: '5%', right: '5%', top: '4%', bottom: '4%', borderWidth: 3, borderStyle: 'dashed', borderColor: 'rgba(255,210,63,0.9)', borderRadius: 10 },
    strip: { flexGrow: 0, marginTop: 8 },
    stripInner: { paddingHorizontal: 16, gap: 8, alignItems: 'center' },
    mini: { width: 42, height: 56, borderRadius: 6, borderWidth: 2, borderColor: t.line },
    miniNew: { borderColor: t.lens },
    stripText: { fontFamily: FONT_BOLD, fontSize: 18, color: t.muted, marginLeft: 4 },
    torch: { position: 'absolute', right: 28, top: 12, minHeight: 44, paddingHorizontal: 14, borderRadius: 12, backgroundColor: 'rgba(13,20,36,0.7)', justifyContent: 'center' },
    torchText: { fontFamily: FONT_BOLD, fontSize: 16, color: '#fff' },
    viewer: { flex: 1.6, backgroundColor: '#0d1424' },
    bubble: { position: 'absolute', borderRadius: 8 },
    bubbleNow: { borderWidth: 3, borderColor: '#ffd23f', backgroundColor: 'rgba(255,210,63,0.18)' },
    word: { position: 'absolute', borderWidth: 2, borderColor: '#e63946', borderRadius: 4, backgroundColor: 'rgba(255,233,138,0.45)' },
    info: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingTop: 10, alignItems: 'center' },
    switch: { minHeight: 36, paddingHorizontal: 12, borderRadius: 999, borderWidth: 2, borderColor: t.ink, justifyContent: 'center', backgroundColor: t.surface },
    switchText: { fontFamily: FONT_BOLD, fontSize: 15, color: t.ink },
    textBox: { paddingHorizontal: 18, paddingTop: 8, minHeight: 64 },
    text: { fontFamily: FONT, color: t.ink },
    smallBig: { minWidth: 76, paddingHorizontal: 10 },
  });
}
