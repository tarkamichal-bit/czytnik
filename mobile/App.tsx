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
import { useKeepAwake } from 'expo-keep-awake';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  useFonts,
  AtkinsonHyperlegible_400Regular,
  AtkinsonHyperlegible_700Bold,
} from '@expo-google-fonts/atkinson-hyperlegible';
import Reader, { Box, OcrWord } from './modules/reader-mlkit/src/ReaderMlkitModule';
import Background from './src/Background';
import { CLAUDE_MODEL, PRICE_IN, PRICE_OUT } from './src/pricing';

// The Anthropic SDK is loaded only when Claude is used, so a problem there can never stop the app from starting.
const loadClaude = () => require('./src/claude') as typeof import('./src/claude');

// ---------- languages ----------
const LANGS: Record<string, string> = {
  pl: 'polski', en: 'angielski', de: 'niemiecki', uk: 'ukraiński', fr: 'francuski', es: 'hiszpański',
  it: 'włoski', cs: 'czeski', sk: 'słowacki', ru: 'rosyjski', pt: 'portugalski', nl: 'niderlandzki',
  sv: 'szwedzki', da: 'duński', no: 'norweski', fi: 'fiński', hu: 'węgierski', ro: 'rumuński',
  lt: 'litewski', lv: 'łotewski', hr: 'chorwacki', tr: 'turecki', el: 'grecki', be: 'białoruski',
};
const TARGETS = ['pl', 'en', 'de', 'uk', 'fr', 'es', 'it'];
const VOICE_TAG: Record<string, string> = {
  pl: 'pl-PL', en: 'en-US', de: 'de-DE', uk: 'uk-UA', fr: 'fr-FR', es: 'es-ES', it: 'it-IT',
};
const langName = (c: string) => LANGS[c] ?? (c || 'nieznany');
const voiceTag = (c: string) => VOICE_TAG[c] ?? c;

// ---------- theme ----------
const THEMES = {
  normal: {
    bg: '#f5f3ee', surface: 'rgba(255,255,255,0.92)', ink: '#14213d', muted: '#4a5470', line: '#d9d5ca',
    lens: '#ffd23f', lensInk: '#14213d', hl: '#ffe98a', ok: '#18794e', warn: '#a14a00', bar: 'dark' as const,
  },
  contrast: {
    bg: '#000000', surface: '#000000', ink: '#ffe600', muted: '#fff3a0', line: '#ffe600',
    lens: '#ffe600', lensInk: '#000000', hl: '#4a4300', ok: '#7dff9b', warn: '#ffb070', bar: 'light' as const,
  },
};
type Theme = (typeof THEMES)[keyof typeof THEMES];

const FONT = 'AtkinsonHyperlegible_400Regular';
const FONT_BOLD = 'AtkinsonHyperlegible_700Bold';

// Yellow frame inside the camera view (fractions of the view). The crop adds a small margin.
const FRAME = { left: 0.06, right: 0.94, top: 0.14, bottom: 0.86 };
const CROP_MARGIN = 0.02;

// ---------- settings ----------
type Engine = 'phone' | 'claude';
type Settings = { target: string; rate: number; autoRead: boolean; contrast: boolean; size: number; engine: Engine };
const DEFAULTS: Settings = { target: 'pl', rate: 0.9, autoRead: true, contrast: false, size: 28, engine: 'phone' };
const RATES = [
  { v: 0.7, label: 'Wolno' },
  { v: 0.9, label: 'Spokojnie' },
  { v: 1.0, label: 'Normalnie' },
  { v: 1.2, label: 'Szybko' },
];

type Usage = { lastIn: number; lastOut: number; lastCost: number; totIn: number; totOut: number; totCost: number; count: number };
const NO_USAGE: Usage = { lastIn: 0, lastOut: 0, lastCost: 0, totIn: 0, totOut: 0, totCost: 0, count: 0 };

// One readable fragment: a paragraph or a comic bubble, with its place on the photo when known.
type Segment = { text: string; translation: string; box?: Box; words: OcrWord[] };
type Reading = { photoUri: string; imgW: number; imgH: number; lang: string; segments: Segment[]; engine: Engine; note?: string };

type Token = { text: string; start: number };
function tokenize(t: string): Token[] {
  const out: Token[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) out.push({ text: m[0], start: m.index });
  return out;
}
function tokenAt(tokens: Token[], charIndex: number) {
  let i = 0;
  while (i + 1 < tokens.length && tokens[i + 1].start <= charIndex) i++;
  return i;
}
function fmtInt(n: number) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}
function fmtUsd(n: number) {
  return '$' + (n < 1 ? n.toFixed(4) : n.toFixed(2)).replace('.', ',');
}

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
  const saveKey = useCallback(async () => {
    const k = keyDraft.trim();
    try {
      if (k) await SecureStore.setItemAsync('anthropic_api_key', k);
      else await SecureStore.deleteItemAsync('anthropic_api_key');
    } catch {}
    setApiKey(k);
    if (k) update({ engine: 'claude' });
  }, [keyDraft, update]);

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
    (r: Reading, startSeg: number, v: 'tr' | 'or', lang: string, rate: number) => {
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
        Speech.speak(text, {
          language: voiceTag(lang),
          rate,
          onBoundary: (ev: { charIndex?: number }) => {
            if (token !== speakToken.current || typeof ev?.charIndex !== 'number') return;
            setCursor({ seg: i, token: tokenAt(tokens, ev.charIndex) });
          },
          onDone: () => next(i + 1),
          onError: () => { if (token === speakToken.current) setCursor(null); },
        });
      };
      next(startSeg);
    },
    [],
  );
  useEffect(() => () => { Speech.stop(); }, []);

  // ---------- capture & read ----------
  const readPhoto = useCallback(async () => {
    if (!cameraRef.current || busy || !lensSize.w) return;
    stopSpeaking();
    setError(null);
    const useClaude = settings.engine === 'claude' && !!apiKey;
    try {
      setBusy('Robię zdjęcie…');
      const photo = await cameraRef.current.takePictureAsync({ quality: 1 });
      if (!photo?.uri) throw new Error('no photo');
      setBusy('Czytam tekst…');
      const { w, h } = lensSize;
      const crop = await Reader.cropToFrame(
        photo.uri, w, h,
        w * (FRAME.left - CROP_MARGIN), h * (FRAME.top - CROP_MARGIN),
        w * (FRAME.right + CROP_MARGIN), h * (FRAME.bottom + CROP_MARGIN),
        useClaude ? 1568 : 0,
      );
      const ocr = await Reader.recognize(crop.uri);
      const base: Segment[] = ocr.blocks.map((b) => ({ text: b.text, translation: b.text, box: b, words: b.words }));
      let segments: Segment[] = base;
      let lang = settings.target;
      let engine: Engine = 'phone';
      let note: string | undefined;

      if (useClaude && crop.base64) {
        setBusy('Claude poprawia tekst…');
        let claude: typeof import('./src/claude') | null = null;
        try {
          claude = loadClaude();
          const c = await claude.readWithClaude(apiKey, crop.base64, base.map((g) => g.text), settings.target, langName(settings.target));
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
      if (settings.autoRead) speakFrom(r, 0, v, translated ? settings.target : lang, settings.rate);
    } catch (e) {
      setError('Nie udało się odczytać zdjęcia. Spróbuj jeszcze raz.');
    } finally {
      setBusy(null);
    }
  }, [busy, lensSize, settings, apiKey, speakFrom, stopSpeaking, addUsage]);

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
  const renderPhoto = (r: Reading) => {
    const { w, h } = lensSize;
    const k = Math.min(w / r.imgW, h / r.imgH);
    const ox = (w - r.imgW * k) / 2;
    const oy = (h - r.imgH * k) / 2;
    const place = (b: Box, pad = 0) => ({
      left: ox + b.left * k - pad, top: oy + b.top * k - pad, width: b.width * k + 2 * pad, height: b.height * k + 2 * pad,
    });
    const cur = cursor ? r.segments[cursor.seg] : null;
    // word highlight only when the voice reads the words that are on the photo
    let wordBox: Box | null = null;
    if (cur && cursor && cursor.token !== null && view === 'or' && cur.words.length) {
      const spokenCount = Math.max(1, tokenize(cur.text).length);
      const idx = spokenCount === cur.words.length
        ? cursor.token
        : Math.round((cursor.token * (cur.words.length - 1)) / Math.max(1, spokenCount - 1));
      wordBox = cur.words[Math.min(cur.words.length - 1, Math.max(0, idx))];
    }
    return (
      <>
        <Image source={{ uri: r.photoUri }} style={StyleSheet.absoluteFill} resizeMode="contain" />
        {r.segments.map((g, i) =>
          g.box ? (
            <Pressable
              key={i}
              onPress={() => speakFrom(r, i, view, speakLang, settings.rate)}
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
          <Text style={s.hint}>Ustaw tekst w żółtej ramce i naciśnij „Czytaj”.</Text>
          {error && <Text style={s.error}>{error}</Text>}
        </View>
      ) : (
        <View style={s.fill}>
          <View style={s.meta}>
            {reading.segments.length ? (
              <Chip s={s} text={reading.lang === settings.target ? langName(reading.lang) : `${langName(reading.lang)} → ${langName(settings.target)}`} color={reading.lang === settings.target ? t.muted : t.ok} />
            ) : null}
            <Chip s={s} text={reading.engine === 'claude' ? 'Claude' : 'Telefon'} color={t.muted} />
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
            <Text style={[s.reading, { fontSize: settings.size, lineHeight: settings.size * 1.45 }]}>
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
              style={[s.big, s.secondary, cursor !== null && s.pressed]}
              onPress={() => (cursor !== null ? stopSpeaking() : speakFrom(reading, 0, view, speakLang, settings.rate))}
              disabled={!reading.segments.length}
              accessibilityRole="button"
              accessibilityLabel={cursor !== null ? 'Zatrzymaj czytanie' : 'Czytaj na głos'}
            >
              <Text style={[s.bigText, cursor !== null && s.pressedText]}>{cursor !== null ? 'Stop' : 'Czytaj\nna głos'}</Text>
            </Pressable>
          </>
        )}
      </View>

      {/* Claude usage counter */}
      {settings.engine === 'claude' && (
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
              Claude poprawia polskie litery i tłumaczy lepiej. Płatne z Twojego konta API Anthropic: {CLAUDE_MODEL}, ${PRICE_IN} za 1 mln tokenów wejścia i ${PRICE_OUT} za 1 mln tokenów wyjścia.
            </Text>
            {settings.engine === 'claude' && (
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
                  <Option s={s} label={apiKey && keyDraft.trim() === apiKey ? 'Zapisany' : 'Zapisz klucz'} on={!!apiKey && keyDraft.trim() === apiKey} onPress={saveKey} />
                  <Option s={s} label="Wyzeruj licznik" on={false} onPress={() => { setUsage(NO_USAGE); AsyncStorage.removeItem('czytnik.usage').catch(() => {}); }} />
                </View>
                <Text style={s.hintSmall}>Klucz utworzysz na platform.claude.com w zakładce API Keys. Jest przechowywany w zaszyfrowanym magazynie telefonu.</Text>
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

// ---------- small components ----------
type S = ReturnType<typeof makeStyles>;

function BigButton({ s, label, onPress, disabled, flex }: { s: S; label: string; onPress: () => void; disabled?: boolean; flex?: boolean }) {
  return (
    <Pressable
      style={({ pressed }) => [s.big, flex && { flex: 1 }, disabled && { opacity: 0.5 }, pressed && { transform: [{ scale: 0.98 }] }]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Text style={s.bigText}>{label}</Text>
    </Pressable>
  );
}

function Option({ s, label, on, onPress }: { s: S; label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable style={[s.opt, on && s.optOn]} onPress={onPress} accessibilityRole="radio" accessibilityState={{ selected: on }}>
      <Text style={[s.optText, on && s.optTextOn]}>{label}</Text>
    </Pressable>
  );
}

function Chip({ s, text, color }: { s: S; text: string; color: string }) {
  return (
    <View style={[s.chip, { borderColor: color }]}>
      <Text style={[s.chipText, { color }]}>{text}</Text>
    </View>
  );
}

function BusyOverlay({ s, text, t }: { s: S; text: string; t: Theme }) {
  return (
    <View style={s.busy}>
      <ActivityIndicator size="large" color={t.lens} />
      <Text style={s.busyText}>{text}</Text>
    </View>
  );
}

// ---------- styles ----------
function makeStyles(t: Theme) {
  return StyleSheet.create({
    fill: { flex: 1 },
    center: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10 },
    h1: { fontFamily: FONT_BOLD, fontSize: 30, color: t.ink },
    h2: { fontFamily: FONT_BOLD, fontSize: 26, color: t.ink },
    body: { fontFamily: FONT, fontSize: 22, color: t.ink },
    smallBtn: { minHeight: 52, paddingHorizontal: 16, borderRadius: 14, borderWidth: 2, borderColor: t.line, backgroundColor: t.surface, justifyContent: 'center' },
    smallBtnText: { fontFamily: FONT_BOLD, fontSize: 18, color: t.ink },
    lens: { flex: 1, marginHorizontal: 16, borderRadius: 20, overflow: 'hidden', borderWidth: 3, borderColor: t.ink, backgroundColor: '#111' },
    lensReading: { flex: 1.25 },
    frameGuide: { position: 'absolute', borderWidth: 4, borderColor: 'rgba(255,210,63,0.95)', borderRadius: 14 },
    segBox: { position: 'absolute', borderWidth: 2, borderColor: 'rgba(255,210,63,0.75)', borderRadius: 8 },
    segBoxNow: { borderWidth: 3, borderColor: '#ffd23f', backgroundColor: 'rgba(255,210,63,0.22)' },
    wordBox: { position: 'absolute', borderWidth: 3, borderColor: '#e63946', borderRadius: 6, backgroundColor: 'rgba(255,233,138,0.45)' },
    hint: { fontFamily: FONT, fontSize: 20, color: t.muted, textAlign: 'center', paddingHorizontal: 16, paddingTop: 12 },
    error: { fontFamily: FONT_BOLD, fontSize: 20, color: t.warn, paddingHorizontal: 16, paddingTop: 8 },
    bar: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 12, borderTopWidth: 2, borderTopColor: t.line, marginTop: 8 },
    big: { minHeight: 76, borderRadius: 20, borderWidth: 3, borderColor: t.ink, backgroundColor: t.lens, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
    bigText: { fontFamily: FONT_BOLD, fontSize: 24, color: t.lensInk, textAlign: 'center' },
    secondary: { backgroundColor: t.surface, minWidth: 110 },
    pressed: { backgroundColor: t.ink },
    pressedText: { color: t.bg },
    busy: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(13,20,36,0.75)', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 20 },
    busyText: { fontFamily: FONT_BOLD, fontSize: 24, color: '#ffffff', textAlign: 'center' },
    meta: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8 },
    chip: { borderWidth: 2, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4, backgroundColor: t.surface },
    chipText: { fontFamily: FONT_BOLD, fontSize: 16 },
    tabs: { flexDirection: 'row', gap: 6, marginHorizontal: 16, padding: 5, borderRadius: 14, borderWidth: 2, borderColor: t.line, backgroundColor: t.surface },
    tab: { flex: 1, minHeight: 48, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
    tabOn: { backgroundColor: t.ink },
    tabText: { fontFamily: FONT_BOLD, fontSize: 19, color: t.ink },
    tabTextOn: { color: t.bg },
    readingWrap: { paddingHorizontal: 18, paddingVertical: 12, gap: 8 },
    reading: { fontFamily: FONT, color: t.ink },
    now: { backgroundColor: t.hl },
    sizeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16, paddingTop: 4 },
    sizeBtn: { width: 72, height: 52, borderRadius: 14, borderWidth: 2, borderColor: t.line, backgroundColor: t.surface, alignItems: 'center', justifyContent: 'center' },
    sizeBtnText: { fontFamily: FONT_BOLD, color: t.ink },
    sizeLabel: { fontFamily: FONT, fontSize: 18, color: t.muted },
    usage: { paddingHorizontal: 16, paddingTop: 6 },
    usageText: { fontFamily: FONT, fontSize: 14, color: t.muted, textAlign: 'center', fontVariant: ['tabular-nums'] },
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
    sheet: { maxHeight: '92%', backgroundColor: t.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, borderWidth: 2, borderColor: t.line },
    label: { fontFamily: FONT_BOLD, fontSize: 20, color: t.ink },
    hintSmall: { fontFamily: FONT, fontSize: 16, color: t.muted },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    opt: { minHeight: 52, paddingHorizontal: 16, borderRadius: 12, borderWidth: 2, borderColor: t.line, backgroundColor: t.surface, justifyContent: 'center' },
    optOn: { backgroundColor: t.ink, borderColor: t.ink },
    optText: { fontFamily: FONT_BOLD, fontSize: 18, color: t.ink },
    optTextOn: { color: t.bg },
    input: { minHeight: 56, borderRadius: 12, borderWidth: 2, borderColor: t.line, backgroundColor: t.surface, paddingHorizontal: 14, fontFamily: FONT, fontSize: 18, color: t.ink },
    switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52 },
  });
}
