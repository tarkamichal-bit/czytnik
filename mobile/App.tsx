import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  LayoutChangeEvent,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Speech from 'expo-speech';
import * as SecureStore from 'expo-secure-store';
import * as Clipboard from 'expo-clipboard';
import { File } from 'expo-file-system';
import { useKeepAwake } from 'expo-keep-awake';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  useFonts,
  AtkinsonHyperlegible_400Regular,
  AtkinsonHyperlegible_700Bold,
} from '@expo-google-fonts/atkinson-hyperlegible';
import Reader, { Box, CropResult, OcrWord, SavedPage } from './modules/reader-mlkit/src/ReaderMlkitModule';
import Eraser from './src/Eraser';
import FullReader from './src/FullReader';
import {
  DEFAULTS, Engine, NO_USAGE, RATES, Settings, VoiceStyle, TARGETS, THEMES, Usage, VOICES, fmtInt, fmtUsd, langName, tokenAt, tokenize, voiceOf, voiceTag, wordClock,
} from './src/shared';
import { BigButton, BusyOverlay, Chip, Option, makeStyles } from './src/ui';
import ComicMode from './src/ComicMode';
import Background from './src/Background';
import { MODELS, modelOf } from './src/pricing';

// The Anthropic SDK is loaded only when Claude is used, so a problem there can never stop the app from starting.
const loadClaude = () => require('./src/claude') as typeof import('./src/claude');


type Mode = 'text' | 'comic' | 'senior';
const MODES: { v: Mode; label: string }[] = [
  { v: 'text', label: 'Tekst' },
  { v: 'comic', label: 'Komiks' },
  { v: 'senior', label: 'Dziad' },
];

// Yellow frame inside the camera view (fractions of the view). The crop adds a small margin.
const FRAME = { left: 0.06, right: 0.94, top: 0.14, bottom: 0.86 };
const CROP_MARGIN = 0.02;

const SAMPLES: Record<VoiceStyle, string> = {
  normal: 'Dzień dobry, będę czytać tekst.',
  teller: 'Dawno, dawno temu, za siedmioma górami…',
  elf: 'Hej! Poczytamy razem bajkę?',
  giant: 'Ho ho, jestem wielki olbrzym.',
};

// One readable fragment: a paragraph or a comic bubble, with its place on the photo when known.
type Segment = { text: string; translation: string; box?: Box; words: OcrWord[] };
// a lone number at the very top or bottom of the photo is a page number, not text to read
const PAGE_NO = /^[\s\-–—.·•|]*(?:(?:str|s|p|page|pag|seite)\.?\s*)?\d{1,4}(?:\s*\/\s*\d{1,4})?[\s\-–—.·•|]*$/i;
function isPageNumber(g: Segment, imgH: number) {
  if (!g.box || !PAGE_NO.test(g.text)) return false;
  const cy = g.box.top + g.box.height / 2;
  return cy < imgH * 0.12 || cy > imgH * 0.88;
}
type Reading = { photoUri: string; imgW: number; imgH: number; lang: string; segments: Segment[]; engine: Engine; note?: string };


export default function App() {
  return (
    <SafeAreaProvider>
      <Main />
    </SafeAreaProvider>
  );
}

function Main() {
  useKeepAwake();
  const insets = useSafeAreaInsets();
  const [fontsLoaded] = useFonts({ AtkinsonHyperlegible_400Regular, AtkinsonHyperlegible_700Bold });
  const [permission, requestPermission] = useCameraPermissions();
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [mode, setMode] = useState<Mode>('text');
  const senior = mode === 'senior';
  const [apiKey, setApiKey] = useState('');
  const [keyDraft, setKeyDraft] = useState('');
  const [usage, setUsage] = useState<Usage>(NO_USAGE);
  const [showSettings, setShowSettings] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [reading, setReading] = useState<Reading | null>(null);
  const [view, setView] = useState<'tr' | 'or'>('tr');
  const [error, setError] = useState<string | null>(null);
  const [torch, setTorch] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [lensSize, setLensSize] = useState({ w: 0, h: 0 });
  const [cursor, setCursor] = useState<{ seg: number; token: number | null } | null>(null);
  const cameraRef = useRef<CameraView>(null);
  const speakToken = useRef(0);

  // "Dziad" mode: calm normal voice, slower, big letters, careful reading by Claude
  const effRate = senior ? Math.min(settings.rate, 0.85) : settings.rate;
  const effVoice: VoiceStyle = senior ? 'normal' : settings.voice;
  const effSize = senior ? Math.max(settings.size, 36) : settings.size;
  const t = settings.contrast ? THEMES.contrast : THEMES.normal;
  const s = useMemo(() => makeStyles(t), [t]);

  // ---------- persistence ----------
  useEffect(() => {
    AsyncStorage.getItem('czytnik.settings').then((raw) => raw && setSettings({ ...DEFAULTS, ...JSON.parse(raw) })).catch(() => {});
    AsyncStorage.getItem('czytnik.usage').then((raw) => raw && setUsage({ ...NO_USAGE, ...JSON.parse(raw) })).catch(() => {});
    SecureStore.getItemAsync('anthropic_api_key').then((k) => { if (k) { setApiKey(k); setKeyDraft(k); } }).catch(() => {});
  }, []);
  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      AsyncStorage.setItem('czytnik.settings', JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);
  const addUsage = useCallback((inTok: number, outTok: number, cost: number) => {
    setUsage((u) => {
      const next = { lastIn: inTok, lastOut: outTok, lastCost: cost, totIn: u.totIn + inTok, totOut: u.totOut + outTok, totCost: u.totCost + cost, count: u.count + 1 };
      AsyncStorage.setItem('czytnik.usage', JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);
  const [keyMsg, setKeyMsg] = useState<string | null>(null);
  const saveKey = useCallback(async (value?: string) => {
    const k = (value ?? keyDraft).trim();
    setKeyDraft(k);
    try {
      if (k) await SecureStore.setItemAsync('anthropic_api_key', k);
      else await SecureStore.deleteItemAsync('anthropic_api_key');
    } catch {}
    setApiKey(k);
    if (k) update({ engine: 'claude' });
  }, [keyDraft, update]);
  // the key is long: instead of typing it, take it from the clipboard or from a text file on the phone
  const KEY_RE = /sk-ant-[A-Za-z0-9_\-]{20,}/;
  const keyFromClipboard = useCallback(async () => {
    try {
      const m = (await Clipboard.getStringAsync()).match(KEY_RE);
      if (!m) { setKeyMsg('W schowku nie ma klucza (zaczyna się od sk-ant-).'); return; }
      await saveKey(m[0]);
      setKeyMsg('Klucz wklejony i zapisany.');
    } catch {
      setKeyMsg('Nie udało się odczytać schowka.');
    }
  }, [saveKey]);
  const keyFromFile = useCallback(async () => {
    try {
      const res = await File.pickFileAsync({ mimeTypes: '*/*' });
      if (res.canceled) return;
      const m = (await res.result.text()).match(KEY_RE);
      if (!m) { setKeyMsg('W tym pliku nie ma klucza (zaczyna się od sk-ant-).'); return; }
      await saveKey(m[0]);
      setKeyMsg('Klucz wczytany i zapisany. Plik możesz teraz usunąć z telefonu.');
    } catch {
      setKeyMsg('Nie udało się odczytać pliku.');
    }
  }, [saveKey]);

  const hasTranslation = !!reading && reading.segments.some((g) => g.translation && g.translation !== g.text);
  const spokenOf = useCallback(
    (g: Segment, v: 'tr' | 'or') => (v === 'tr' && hasTranslation ? g.translation || g.text : g.text),
    [hasTranslation],
  );
  const speakLang = reading ? (view === 'tr' && hasTranslation ? settings.target : reading.lang || settings.target) : settings.target;

  // ---------- speech ----------
  const stopSpeaking = useCallback(() => {
    speakToken.current++;
    Speech.stop();
    setCursor(null);
  }, []);

  const speakFrom = useCallback(
    (r: Reading, startSeg: number, v: 'tr' | 'or', lang: string, rate: number, style: VoiceStyle) => {
      const vs = voiceOf(style);
      speakToken.current++;
      const token = speakToken.current;
      Speech.stop();
      const translated = r.segments.some((g) => g.translation && g.translation !== g.text);
      const textOf = (g: Segment) => (v === 'tr' && translated ? g.translation || g.text : g.text);
      // one fragment per utterance: the word callbacks then map straight onto that fragment
      const next = (i: number) => {
        if (token !== speakToken.current) return;
        if (i >= r.segments.length) { setCursor(null); return; }
        const text = textOf(r.segments[i]).slice(0, 3900);
        if (!text.trim()) { next(i + 1); return; }
        const tokens = tokenize(text);
        setCursor({ seg: i, token: 0 });
        const ck: { c?: ReturnType<typeof wordClock> } = {};
        Speech.speak(text, {
          language: voiceTag(lang),
          rate: rate * vs.rateMul,
          pitch: vs.pitch,
          onStart: () => {
            ck.c = wordClock(tokens, rate * vs.rateMul, (k) => {
              if (token === speakToken.current) setCursor({ seg: i, token: k });
              else ck.c?.stop();
            });
          },
          onBoundary: (ev: { charIndex?: number }) => {
            ck.c?.real();
            if (token !== speakToken.current || typeof ev?.charIndex !== 'number') return;
            setCursor({ seg: i, token: tokenAt(tokens, ev.charIndex) });
          },
          onDone: () => { ck.c?.stop(); next(i + 1); },
          onStopped: () => ck.c?.stop(),
          onError: () => { ck.c?.stop(); if (token === speakToken.current) setCursor(null); },
        });
      };
      next(startSeg);
    },
    [],
  );
  useEffect(() => () => { Speech.stop(); }, []);

  // ---------- capture & read ----------
  // Reads an image that is already cropped (fresh from the camera, or after the eraser).
  const readImage = useCallback(async (img: SavedPage, b64: string | null) => {
    const useClaude = (senior || settings.engine === 'claude') && !!apiKey;
    try {
      setBusy('Czytam tekst…');
      const crop = { ...img, base64: b64 };
      if (useClaude && !crop.base64) {
        crop.base64 = (await Reader.cropToFrame(img.uri, img.width, img.height, 0, 0, img.width, img.height, 1568)).base64;
      }
      const ocr = await Reader.recognize(crop.uri);
      const base: Segment[] = ocr.blocks.map((b) => ({ text: b.text, translation: b.text, box: b, words: b.words }));
      let segments: Segment[] = base;
      let lang = settings.target;
      let engine: Engine = 'phone';
      let note: string | undefined;

      if (useClaude && crop.base64) {
        setBusy(senior ? 'Claude uważnie odczytuje tekst…\nTo może potrwać do minuty.' : 'Claude poprawia tekst…');
        let claude: typeof import('./src/claude') | null = null;
        try {
          claude = loadClaude();
          const c = await claude.readWithClaude(settings.model, apiKey, crop.base64, base.map((g) => g.text), settings.target, langName(settings.target), { careful: senior });
          addUsage(c.inputTokens, c.outputTokens, c.costUsd);
          lang = c.lang || settings.target;
          engine = 'claude';
          if (base.length && c.blocks.length === base.length) {
            segments = base.map((g, i) => ({ ...g, text: c.blocks[i].text, translation: c.blocks[i].translation || c.blocks[i].text }));
          } else {
            // Claude saw a different split than the phone: keep its text, without positions
            segments = c.blocks.map((b) => ({ text: b.text, translation: b.translation || b.text, words: [] }));
          }
        } catch (e) {
          note = (claude ? claude.describeClaudeError(e) : 'Claude niedostępny.') + ' Czytam rozpoznawaniem w telefonie.';
        }
      }

      if (engine === 'phone') segments = segments.filter((g) => !isPageNumber(g, crop.height));
      if (engine === 'phone' && segments.length) {
        const all = segments.map((g) => g.text).join('\n');
        try { lang = (await Reader.identifyLanguage(all)).split('-')[0]; } catch {}
        if (lang === 'und') lang = settings.target;
        if (lang !== settings.target) {
          setBusy(`Tłumaczę z języka: ${langName(lang)}…\nZa pierwszym razem pobieram słownik.`);
          try {
            const out: Segment[] = [];
            for (const g of segments) out.push({ ...g, translation: await Reader.translate(g.text, lang, settings.target) });
            segments = out;
          } catch {
            note = 'Tłumaczenie niedostępne (brak internetu przy pierwszym użyciu?)';
          }
        }
      }

      segments = segments.filter((g) => g.text.trim());
      const r: Reading = { photoUri: crop.uri, imgW: crop.width, imgH: crop.height, lang, segments, engine, note };
      setReading(r);
      if (!segments.length) {
        setError('Nie znalazłem tekstu w ramce. Podejdź bliżej, włącz latarkę i spróbuj jeszcze raz.');
        return;
      }
      const translated = segments.some((g) => g.translation && g.translation !== g.text);
      const v = translated ? 'tr' : 'or';
      setView(v);
      if (settings.autoRead) speakFrom(r, 0, v, translated ? settings.target : lang, effRate, effVoice);
    } catch (e) {
      setError('Nie udało się odczytać zdjęcia. Spróbuj jeszcze raz.');
    } finally {
      setBusy(null);
    }
  }, [settings, apiKey, senior, effRate, effVoice, speakFrom, addUsage]);

  const readPhoto = useCallback(async () => {
    if (!cameraRef.current || busy || !lensSize.w) return;
    stopSpeaking();
    setError(null);
    const useClaude = (senior || settings.engine === 'claude') && !!apiKey;
    let crop: CropResult;
    try {
      setBusy('Robię zdjęcie…');
      const photo = await cameraRef.current.takePictureAsync({ quality: 1 });
      if (!photo?.uri) throw new Error('no photo');
      const { w, h } = lensSize;
      crop = await Reader.cropToFrame(
        photo.uri, w, h,
        w * (FRAME.left - CROP_MARGIN), h * (FRAME.top - CROP_MARGIN),
        w * (FRAME.right + CROP_MARGIN), h * (FRAME.bottom + CROP_MARGIN),
        useClaude ? 1568 : 0,
      );
    } catch {
      setBusy(null);
      setError('Nie udało się zrobić zdjęcia. Spróbuj jeszcze raz.');
      return;
    }
    await readImage(crop, crop.base64);
  }, [busy, lensSize, settings.engine, apiKey, senior, stopSpeaking, readImage]);

  const [erasing, setErasing] = useState<SavedPage | null>(null);
  const openEraser = () => {
    if (!reading) return;
    stopSpeaking();
    setErasing({ uri: reading.photoUri, width: reading.imgW, height: reading.imgH });
  };
  const afterErase = (img: SavedPage) => {
    setErasing(null);
    setError(null);
    readImage(img, null);
  };

  const newPhoto = () => { stopSpeaking(); setReading(null); setError(null); };
  const onLensLayout = (e: LayoutChangeEvent) => setLensSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });

  if (!fontsLoaded || !permission) {
    return <View style={[s.fill, { backgroundColor: t.bg }]} />;
  }

  // ---------- permission ----------
  if (!permission.granted) {
    return (
      <View style={[s.fill, s.center, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
        <Background contrast={settings.contrast} />
        <StatusBar style={t.bar} />
        <Text style={s.h1}>Czytnik</Text>
        <Text style={[s.body, { textAlign: 'center', marginVertical: 24 }]}>
          Aby czytać tekst, aplikacja potrzebuje dostępu do aparatu.
        </Text>
        <BigButton s={s} label="Pozwól na aparat" onPress={requestPermission} />
      </View>
    );
  }

  // ---------- photo with highlights ----------
  // word highlight only when the voice reads the words that are on the photo
  const wordBoxOf = (r: Reading): Box | null => {
    const cur = cursor ? r.segments[cursor.seg] : null;
    if (!cur || !cursor || cursor.token === null || view !== 'or' || !cur.words.length) return null;
    const spokenCount = Math.max(1, tokenize(cur.text).length);
    const idx = spokenCount === cur.words.length
      ? cursor.token
      : Math.round((cursor.token * (cur.words.length - 1)) / Math.max(1, spokenCount - 1));
    return cur.words[Math.min(cur.words.length - 1, Math.max(0, idx))];
  };
  const renderPhoto = (r: Reading) => {
    const { w, h } = lensSize;
    const k = Math.min(w / r.imgW, h / r.imgH);
    const ox = (w - r.imgW * k) / 2;
    const oy = (h - r.imgH * k) / 2;
    const place = (b: Box, pad = 0) => ({
      left: ox + b.left * k - pad, top: oy + b.top * k - pad, width: b.width * k + 2 * pad, height: b.height * k + 2 * pad,
    });
    const wordBox = wordBoxOf(r);
    return (
      <>
        <Image source={{ uri: r.photoUri }} style={StyleSheet.absoluteFill} resizeMode="contain" />
        {r.segments.map((g, i) =>
          g.box ? (
            <Pressable
              key={i}
              onPress={() => speakFrom(r, i, view, speakLang, effRate, effVoice)}
              accessibilityRole="button"
              accessibilityLabel={`Czytaj od fragmentu ${i + 1}`}
              style={[s.segBox, place(g.box, 4), cursor?.seg === i && s.segBoxNow]}
            />
          ) : null,
        )}
        {wordBox && <View pointerEvents="none" style={[s.wordBox, place(wordBox, 3)]} />}
      </>
    );
  };

  const curSeg = reading && cursor ? reading.segments[cursor.seg] : null;
  const panelSeg = curSeg ?? reading?.segments[0] ?? null;
  const panelText = panelSeg ? spokenOf(panelSeg, view) : '';
  const panelTokens = tokenize(panelText);

  return (
    <View style={[s.fill, { paddingTop: insets.top }]}>
      <Background contrast={settings.contrast} />
      <StatusBar style={t.bar} />
      {/* header */}
      <View style={s.header}>
        <Text style={s.h1}>Czytnik</Text>
        <Pressable style={s.smallBtn} onPress={() => setShowSettings(true)} accessibilityRole="button" accessibilityLabel="Ustawienia">
          <Text style={s.smallBtnText}>Ustawienia</Text>
        </Pressable>
      </View>

      {/* modes */}
      <View style={s.tabs}>
        {MODES.map((m) => (
          <Pressable
            key={m.v}
            style={[s.tab, mode === m.v && s.tabOn]}
            onPress={() => { stopSpeaking(); setReading(null); setError(null); setMode(m.v); }}
            accessibilityRole="tab"
            accessibilityState={{ selected: mode === m.v }}
          >
            <Text style={[s.tabText, mode === m.v && s.tabTextOn]}>{m.label}</Text>
          </Pressable>
        ))}
      </View>
      {senior && !apiKey && reading === null && (
        <Text style={s.error}>Do drobnego i nieostrego druku dodaj klucz Claude w Ustawieniach. Bez niego czytam rozpoznawaniem z telefonu.</Text>
      )}

      {mode === 'comic' ? (
        <ComicMode
          s={s}
          t={t}
          settings={settings}
          apiKey={apiKey}
          addUsage={addUsage}
          bottomInset={settings.engine === 'claude' ? 6 : insets.bottom + 12}
        />
      ) : (
      <>
      {/* lens: live camera, or the photo being read */}
      <View style={[s.lens, reading ? s.lensReading : null]} onLayout={onLensLayout}>
        {reading ? (
          lensSize.w > 0 && renderPhoto(reading)
        ) : (
          <>
            <CameraView
              ref={cameraRef}
              style={StyleSheet.absoluteFill}
              facing="back"
              autofocus="on"
              enableTorch={torch}
              onCameraReady={() => setCameraReady(true)}
            />
            <View
              pointerEvents="none"
              style={[s.frameGuide, { left: `${FRAME.left * 100}%`, right: `${(1 - FRAME.right) * 100}%`, top: `${FRAME.top * 100}%`, bottom: `${(1 - FRAME.bottom) * 100}%` }]}
            />
          </>
        )}
        {busy && <BusyOverlay s={s} text={busy} t={t} />}
      </View>

      {reading === null ? (
        <View style={s.fill}>
          <Text style={s.hint}>{senior ? 'Połóż kartkę płasko, ustaw tekst w żółtej ramce i naciśnij „Czytaj”.' : 'Ustaw tekst w żółtej ramce i naciśnij „Czytaj”.'}</Text>
          {error && <Text style={s.error}>{error}</Text>}
        </View>
      ) : (
        <View style={s.fill}>
          <View style={s.meta}>
            {reading.segments.length ? (
              <Chip s={s} text={reading.lang === settings.target ? langName(reading.lang) : `${langName(reading.lang)} → ${langName(settings.target)}`} color={reading.lang === settings.target ? t.muted : t.ok} />
            ) : null}
            <Chip s={s} text={reading.engine === 'claude' ? 'Claude' : 'Telefon'} color={t.muted} />
            <Pressable onPress={() => update({ layout: 'full' })} style={[s.smallBtn, { minHeight: 40 }]} accessibilityRole="button" accessibilityLabel="Pokaż zdjęcie na całym ekranie">
              <Text style={s.smallBtnText}>Duży obraz</Text>
            </Pressable>
            {reading.note ? <Chip s={s} text={reading.note} color={t.warn} /> : null}
          </View>
          {hasTranslation && (
            <View style={s.tabs}>
              {(['tr', 'or'] as const).map((k) => (
                <Pressable
                  key={k}
                  style={[s.tab, view === k && s.tabOn]}
                  onPress={() => { stopSpeaking(); setView(k); }}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: view === k }}
                >
                  <Text style={[s.tabText, view === k && s.tabTextOn]}>{k === 'tr' ? 'Tłumaczenie' : 'Oryginał'}</Text>
                </Pressable>
              ))}
            </View>
          )}
          <ScrollView style={s.fill} contentContainerStyle={s.readingWrap}>
            {error ? <Text style={s.error}>{error}</Text> : null}
            <Text style={[s.reading, { fontSize: effSize, lineHeight: effSize * 1.45 }]}>
              {panelTokens.map((tk, i) => (
                <Text key={i} style={curSeg && cursor?.token === i ? s.now : undefined}>
                  {tk.text}{i < panelTokens.length - 1 ? ' ' : ''}
                </Text>
              ))}
            </Text>
            {reading.segments.length > 1 && (
              <Text style={s.hintSmall}>
                Fragment {(cursor?.seg ?? 0) + 1} z {reading.segments.length}. Dotknij miejsca na zdjęciu, aby czytać od niego.
              </Text>
            )}
          </ScrollView>
          <View style={s.sizeRow}>
            <Pressable style={s.sizeBtn} onPress={() => update({ size: Math.max(18, settings.size - 4) })} accessibilityLabel="Mniejsze litery">
              <Text style={[s.sizeBtnText, { fontSize: 18 }]}>A−</Text>
            </Pressable>
            <Text style={s.sizeLabel}>Litery</Text>
            <Pressable style={s.sizeBtn} onPress={() => update({ size: Math.min(64, settings.size + 4) })} accessibilityLabel="Większe litery">
              <Text style={[s.sizeBtnText, { fontSize: 28 }]}>A+</Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* action bar */}
      <View style={[s.bar, { paddingBottom: (settings.engine === 'claude' ? 6 : insets.bottom + 12) }]}>
        {reading === null ? (
          <>
            <BigButton s={s} label="Czytaj" onPress={readPhoto} disabled={!cameraReady || !!busy} flex />
            <Pressable
              style={[s.big, s.secondary, torch && s.pressed]}
              onPress={() => setTorch((v) => !v)}
              accessibilityRole="switch"
              accessibilityState={{ checked: torch }}
              accessibilityLabel="Latarka"
            >
              <Text style={[s.bigText, torch && s.pressedText]}>{torch ? 'Latarka\nwł.' : 'Latarka'}</Text>
            </Pressable>
          </>
        ) : (
          <>
            <BigButton s={s} label="Nowe zdjęcie" onPress={newPhoto} flex />
            <Pressable
              style={[s.big, s.secondary, { minWidth: 92, paddingHorizontal: 10 }, !!busy && { opacity: 0.4 }]}
              onPress={openEraser}
              disabled={!!busy}
              accessibilityRole="button"
              accessibilityLabel="Gumka: zamaż część zdjęcia, której nie trzeba czytać"
            >
              <Text style={s.bigText}>Gumka</Text>
            </Pressable>
            <Pressable
              style={[s.big, s.secondary, cursor !== null && s.pressed]}
              onPress={() => (cursor !== null ? stopSpeaking() : speakFrom(reading, 0, view, speakLang, effRate, effVoice))}
              disabled={!reading.segments.length}
              accessibilityRole="button"
              accessibilityLabel={cursor !== null ? 'Zatrzymaj czytanie' : 'Czytaj na głos'}
            >
              <Text style={[s.bigText, cursor !== null && s.pressedText]}>{cursor !== null ? 'Stop' : 'Czytaj\nna głos'}</Text>
            </Pressable>
          </>
        )}
      </View>

      </>
      )}

      {/* Claude usage counter */}
      {(settings.engine === 'claude' || (senior && !!apiKey)) && (
        <View style={[s.usage, { paddingBottom: insets.bottom + 8 }]}>
          {apiKey ? (
            <Text style={s.usageText}>
              Ostatnio: {fmtInt(usage.lastIn)} + {fmtInt(usage.lastOut)} tok. = {fmtUsd(usage.lastCost)}
              {'   '}Razem ({usage.count}): {fmtInt(usage.totIn + usage.totOut)} tok. = {fmtUsd(usage.totCost)}
            </Text>
          ) : (
            <Text style={s.usageText}>Podaj klucz API Claude w Ustawieniach.</Text>
          )}
        </View>
      )}

      {mode !== 'comic' && reading && reading.segments.length > 0 && settings.layout === 'full' && !busy && (
        <FullReader
          s={s}
          t={t}
          photoUri={reading.photoUri}
          imgW={reading.imgW}
          imgH={reading.imgH}
          segments={reading.segments}
          current={cursor?.seg ?? null}
          wordBox={wordBoxOf(reading)}
          tokens={curSeg ? panelTokens : []}
          token={curSeg ? cursor?.token ?? null : null}
          playing={cursor !== null}
          onTap={(i) => speakFrom(reading, i, view, speakLang, effRate, effVoice)}
          onPlayStop={() => (cursor !== null ? stopSpeaking() : speakFrom(reading, 0, view, speakLang, effRate, effVoice))}
          onSplit={() => update({ layout: 'split' })}
          onNew={newPhoto}
          onErase={openEraser}
        />
      )}
      <Eraser t={t} image={erasing} onDone={afterErase} onCancel={() => setErasing(null)} />

      {/* ---------- settings ---------- */}
      <Modal visible={showSettings} animationType="slide" transparent onRequestClose={() => setShowSettings(false)}>
        <View style={s.backdrop}>
          <ScrollView style={s.sheet} contentContainerStyle={{ gap: 18, paddingBottom: insets.bottom + 24 }} keyboardShouldPersistTaps="handled">
            <Text style={s.h2}>Ustawienia</Text>

            <Text style={s.label}>Rozpoznawanie tekstu</Text>
            <View style={s.grid}>
              <Option s={s} label="Telefon (darmowe)" on={settings.engine === 'phone'} onPress={() => update({ engine: 'phone' })} />
              <Option s={s} label="Claude (dokładne)" on={settings.engine === 'claude'} onPress={() => update({ engine: 'claude' })} />
            </View>
            <Text style={s.hintSmall}>
              Claude poprawia polskie litery i tłumaczy lepiej. Płatne z Twojego konta API Anthropic: {modelOf(settings.model).label.split(' (')[0]}, ${modelOf(settings.model).in} za 1 mln tokenów wejścia i ${modelOf(settings.model).out} za 1 mln tokenów wyjścia.
            </Text>
            <Text style={s.label}>Model Claude</Text>
            <View style={s.grid}>
              {MODELS.map((m) => (
                <Option key={m.id} s={s} label={m.label} on={settings.model === m.id} onPress={() => update({ model: m.id })} />
              ))}
            </View>
            {(settings.engine === 'claude' || mode === 'senior' || !apiKey) && (
              <>
                <Text style={s.label}>Klucz API Claude</Text>
                <TextInput
                  value={keyDraft}
                  onChangeText={setKeyDraft}
                  placeholder="sk-ant-…"
                  placeholderTextColor={t.muted}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={s.input}
                />
                <View style={s.grid}>
                  <Option s={s} label={apiKey && keyDraft.trim() === apiKey ? 'Zapisany' : 'Zapisz klucz'} on={!!apiKey && keyDraft.trim() === apiKey} onPress={() => saveKey()} />
                  <Option s={s} label="Wklej ze schowka" on={false} onPress={keyFromClipboard} />
                  <Option s={s} label="Wczytaj z pliku" on={false} onPress={keyFromFile} />
                  <Option s={s} label="Wyzeruj licznik" on={false} onPress={() => { setUsage(NO_USAGE); AsyncStorage.removeItem('czytnik.usage').catch(() => {}); }} />
                </View>
                {keyMsg ? <Text style={[s.hintSmall, { color: t.ink }]}>{keyMsg}</Text> : null}
                <Text style={s.hintSmall}>
                  Klucz utworzysz na platform.claude.com w zakładce API Keys. Nie musisz go przepisywać: skopiuj go i naciśnij „Wklej ze schowka” albo zapisz w pliku tekstowym na telefonie (np. w Pobranych) i naciśnij „Wczytaj z pliku”. Klucz jest przechowywany w zaszyfrowanym magazynie telefonu.
                </Text>
              </>
            )}

            <Text style={s.label}>Język lektora</Text>
            <View style={s.grid}>
              {TARGETS.map((c) => (
                <Option key={c} s={s} label={langName(c)} on={settings.target === c} onPress={() => update({ target: c })} />
              ))}
            </View>
            <Text style={s.hintSmall}>Tekst w innym języku zostanie przetłumaczony na ten język.</Text>
            <Text style={s.label}>Tempo czytania</Text>
            <View style={s.grid}>
              {RATES.map((r) => (
                <Option key={r.v} s={s} label={r.label} on={settings.rate === r.v} onPress={() => update({ rate: r.v })} />
              ))}
            </View>
            <Text style={s.label}>Głos lektora</Text>
            <View style={s.grid}>
              {VOICES.map((x) => (
                <Option
                  key={x.v}
                  s={s}
                  label={x.label}
                  on={settings.voice === x.v}
                  onPress={() => {
                    update({ voice: x.v });
                    Speech.stop();
                    Speech.speak(SAMPLES[x.v], { language: 'pl-PL', rate: settings.rate * x.rateMul, pitch: x.pitch });
                  }}
                />
              ))}
            </View>
            <Text style={s.hintSmall}>Dotknij, aby posłuchać próbki.</Text>
            <Text style={s.label}>Głos w komiksach</Text>
            <View style={s.grid}>
              {VOICES.map((x) => (
                <Option
                  key={x.v}
                  s={s}
                  label={x.label}
                  on={settings.comicVoice === x.v}
                  onPress={() => {
                    update({ comicVoice: x.v });
                    Speech.stop();
                    Speech.speak(SAMPLES[x.v], { language: 'pl-PL', rate: settings.rate * x.rateMul, pitch: x.pitch });
                  }}
                />
              ))}
            </View>
            <Text style={s.label}>Widok podczas czytania</Text>
            <View style={s.grid}>
              <Option s={s} label="Duży obraz" on={settings.layout === 'full'} onPress={() => update({ layout: 'full' })} />
              <Option s={s} label="Obraz i tekst" on={settings.layout === 'split'} onPress={() => update({ layout: 'split' })} />
            </View>
            <Text style={s.hintSmall}>„Duży obraz”: zdjęcie na cały ekran, widok przesuwa się za czytanym fragmentem i linijką.</Text>
            <View style={s.switchRow}>
              <Text style={[s.label, { flex: 1 }]}>Czytaj od razu po zdjęciu</Text>
              <Switch value={settings.autoRead} onValueChange={(v) => update({ autoRead: v })} />
            </View>
            <View style={s.switchRow}>
              <Text style={[s.label, { flex: 1 }]}>Wysoki kontrast (żółte na czarnym)</Text>
              <Switch value={settings.contrast} onValueChange={(v) => update({ contrast: v })} />
            </View>
            <BigButton s={s} label="Gotowe" onPress={() => setShowSettings(false)} />
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

