import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Speech from 'expo-speech';
import { useKeepAwake } from 'expo-keep-awake';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  useFonts,
  AtkinsonHyperlegible_400Regular,
  AtkinsonHyperlegible_700Bold,
} from '@expo-google-fonts/atkinson-hyperlegible';
import Reader from './modules/reader-mlkit/src/ReaderMlkitModule';

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
    bg: '#f5f3ee', surface: '#ffffff', ink: '#14213d', muted: '#4a5470', line: '#d9d5ca',
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

// ---------- settings ----------
type Settings = { target: string; rate: number; autoRead: boolean; contrast: boolean; size: number };
const DEFAULTS: Settings = { target: 'pl', rate: 0.9, autoRead: true, contrast: false, size: 30 };
const RATES = [
  { v: 0.7, label: 'Wolno' },
  { v: 0.9, label: 'Spokojnie' },
  { v: 1.0, label: 'Normalnie' },
  { v: 1.2, label: 'Szybko' },
];

type Result = { text: string; lang: string; translation: string; note?: string };

function splitSentences(t: string): string[] {
  const parts = t.match(/[^.!?…\n]+(?:[.!?…]+["”»)]?|\n+|$)\s*/g) ?? [];
  return parts.filter((s) => s.trim().length > 0);
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
  const [showSettings, setShowSettings] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [view, setView] = useState<'tr' | 'or'>('tr');
  const [error, setError] = useState<string | null>(null);
  const [torch, setTorch] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [speakingIdx, setSpeakingIdx] = useState<number | null>(null);
  const cameraRef = useRef<CameraView>(null);
  const speakToken = useRef(0);

  const t = settings.contrast ? THEMES.contrast : THEMES.normal;
  const s = useMemo(() => makeStyles(t), [t]);

  // settings persistence
  useEffect(() => {
    AsyncStorage.getItem('czytnik.settings')
      .then((raw) => raw && setSettings({ ...DEFAULTS, ...JSON.parse(raw) }))
      .catch(() => {});
  }, []);
  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      AsyncStorage.setItem('czytnik.settings', JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const hasTranslation = !!result && !!result.translation && result.translation !== result.text;
  const shownText = result ? (view === 'tr' && hasTranslation ? result.translation : result.text) : '';
  const shownLang = result ? (view === 'tr' && hasTranslation ? settings.target : result.lang || settings.target) : settings.target;
  const sentences = useMemo(() => splitSentences(shownText), [shownText]);

  // ---------- speech ----------
  const stopSpeaking = useCallback(() => {
    speakToken.current++;
    Speech.stop();
    setSpeakingIdx(null);
  }, []);

  const speakFrom = useCallback(
    (list: string[], lang: string, rate: number) => {
      speakToken.current++;
      const token = speakToken.current;
      Speech.stop();
      // one sentence at a time: lets us highlight it and stays under Android's input limit
      const next = (i: number) => {
        if (token !== speakToken.current) return;
        if (i >= list.length) { setSpeakingIdx(null); return; }
        setSpeakingIdx(i);
        Speech.speak(list[i].trim(), {
          language: voiceTag(lang),
          rate,
          onDone: () => next(i + 1),
          onError: () => { if (token === speakToken.current) setSpeakingIdx(null); },
        });
      };
      next(0);
    },
    [],
  );

  useEffect(() => () => { Speech.stop(); }, []);

  // ---------- capture & read ----------
  const readPhoto = useCallback(async () => {
    if (!cameraRef.current || busy) return;
    stopSpeaking();
    setError(null);
    try {
      setBusy('Robię zdjęcie…');
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.9 });
      if (!photo?.uri) throw new Error('no photo');
      setBusy('Czytam tekst…');
      const text = (await Reader.recognize(photo.uri)).trim();
      if (!text) {
        setResult({ text: '', lang: '', translation: '' });
        setError('Nie znalazłem tekstu. Podejdź bliżej, włącz latarkę i spróbuj jeszcze raz.');
        return;
      }
      let lang = 'und';
      try { lang = (await Reader.identifyLanguage(text)).split('-')[0]; } catch {}
      if (lang === 'und') lang = settings.target;
      let translation = text;
      let note: string | undefined;
      if (lang !== settings.target) {
        setBusy(`Tłumaczę z języka: ${langName(lang)}…\nZa pierwszym razem pobieram słownik.`);
        try {
          const out: string[] = [];
          for (const para of text.split(/\n{2,}/)) out.push(await Reader.translate(para, lang, settings.target));
          translation = out.join('\n\n');
        } catch {
          note = 'Tłumaczenie niedostępne (brak internetu przy pierwszym użyciu?)';
          translation = text;
        }
      }
      const r: Result = { text, lang, translation, note };
      setResult(r);
      const useTr = translation !== text;
      setView(useTr ? 'tr' : 'or');
      if (settings.autoRead) {
        speakFrom(splitSentences(useTr ? translation : text), useTr ? settings.target : lang, settings.rate);
      }
    } catch (e) {
      setError('Nie udało się odczytać zdjęcia. Spróbuj jeszcze raz.');
    } finally {
      setBusy(null);
    }
  }, [busy, settings, speakFrom, stopSpeaking]);

  const newPhoto = () => { stopSpeaking(); setResult(null); setError(null); };

  if (!fontsLoaded || !permission) {
    return <View style={[s.fill, { backgroundColor: t.bg }]} />;
  }

  // ---------- permission ----------
  if (!permission.granted) {
    return (
      <View style={[s.fill, s.center, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
        <StatusBar style={t.bar} />
        <Text style={s.h1}>Czytnik</Text>
        <Text style={[s.body, { textAlign: 'center', marginVertical: 24 }]}>
          Aby czytać tekst, aplikacja potrzebuje dostępu do aparatu.
        </Text>
        <BigButton s={s} label="Pozwól na aparat" onPress={requestPermission} />
      </View>
    );
  }

  return (
    <View style={[s.fill, { paddingTop: insets.top }]}>
      <StatusBar style={t.bar} />
      {/* header */}
      <View style={s.header}>
        <Text style={s.h1}>Czytnik</Text>
        <Pressable
          style={s.smallBtn}
          onPress={() => setShowSettings(true)}
          accessibilityRole="button"
          accessibilityLabel="Ustawienia"
        >
          <Text style={s.smallBtnText}>Ustawienia</Text>
        </Pressable>
      </View>

      {result === null ? (
        // ---------- camera ----------
        <View style={s.fill}>
          <View style={s.lens}>
            <CameraView
              ref={cameraRef}
              style={StyleSheet.absoluteFill}
              facing="back"
              autofocus="on"
              enableTorch={torch}
              onCameraReady={() => setCameraReady(true)}
            />
            <View pointerEvents="none" style={s.frameGuide} />
            {busy && <BusyOverlay s={s} text={busy} t={t} />}
          </View>
          <Text style={s.hint}>Skieruj aparat na tekst i naciśnij żółty przycisk.</Text>
          {error && <Text style={s.error}>{error}</Text>}
          <View style={[s.bar, { paddingBottom: insets.bottom + 12 }]}>
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
          </View>
        </View>
      ) : (
        // ---------- result ----------
        <View style={s.fill}>
          <View style={s.meta}>
            {result.text ? (
              <Chip
                s={s}
                text={result.lang === settings.target ? langName(result.lang) : `${langName(result.lang)} → ${langName(settings.target)}`}
                color={result.lang === settings.target ? t.muted : t.ok}
              />
            ) : null}
            {result.note ? <Chip s={s} text={result.note} color={t.warn} /> : null}
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
            <Text style={[s.reading, { fontSize: settings.size, lineHeight: settings.size * 1.5 }]}>
              {sentences.map((x, i) => (
                <Text key={i} style={speakingIdx === i ? s.now : undefined}>{x}</Text>
              ))}
            </Text>
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
          <View style={[s.bar, { paddingBottom: insets.bottom + 12 }]}>
            <BigButton s={s} label="Nowe zdjęcie" onPress={newPhoto} flex />
            <Pressable
              style={[s.big, s.secondary, speakingIdx !== null && s.pressed]}
              onPress={() => (speakingIdx !== null ? stopSpeaking() : speakFrom(sentences, shownLang, settings.rate))}
              disabled={!shownText}
              accessibilityRole="button"
              accessibilityLabel={speakingIdx !== null ? 'Zatrzymaj czytanie' : 'Czytaj na głos'}
            >
              <Text style={[s.bigText, speakingIdx !== null && s.pressedText]}>{speakingIdx !== null ? 'Stop' : 'Czytaj\nna głos'}</Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* ---------- settings ---------- */}
      <Modal visible={showSettings} animationType="slide" transparent onRequestClose={() => setShowSettings(false)}>
        <View style={s.backdrop}>
          <ScrollView style={s.sheet} contentContainerStyle={{ gap: 18, paddingBottom: insets.bottom + 24 }}>
            <Text style={s.h2}>Ustawienia</Text>
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
    fill: { flex: 1, backgroundColor: t.bg },
    center: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10 },
    h1: { fontFamily: FONT_BOLD, fontSize: 30, color: t.ink },
    h2: { fontFamily: FONT_BOLD, fontSize: 26, color: t.ink },
    body: { fontFamily: FONT, fontSize: 22, color: t.ink },
    smallBtn: { minHeight: 52, paddingHorizontal: 16, borderRadius: 14, borderWidth: 2, borderColor: t.line, backgroundColor: t.surface, justifyContent: 'center' },
    smallBtnText: { fontFamily: FONT_BOLD, fontSize: 18, color: t.ink },
    lens: { flex: 1, marginHorizontal: 16, borderRadius: 20, overflow: 'hidden', borderWidth: 3, borderColor: t.ink, backgroundColor: '#111' },
    frameGuide: { position: 'absolute', left: '8%', right: '8%', top: '20%', bottom: '20%', borderWidth: 3, borderColor: 'rgba(255,210,63,0.85)', borderRadius: 14 },
    hint: { fontFamily: FONT, fontSize: 20, color: t.muted, textAlign: 'center', paddingHorizontal: 16, paddingTop: 12 },
    error: { fontFamily: FONT_BOLD, fontSize: 20, color: t.warn, paddingHorizontal: 16, paddingTop: 8 },
    bar: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 12, backgroundColor: t.bg, borderTopWidth: 2, borderTopColor: t.line, marginTop: 12 },
    big: { minHeight: 76, borderRadius: 20, borderWidth: 3, borderColor: t.ink, backgroundColor: t.lens, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
    bigText: { fontFamily: FONT_BOLD, fontSize: 24, color: t.lensInk, textAlign: 'center' },
    secondary: { backgroundColor: t.surface, minWidth: 110 },
    pressed: { backgroundColor: t.ink },
    pressedText: { color: t.bg },
    busy: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(13,20,36,0.75)', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 20 },
    busyText: { fontFamily: FONT_BOLD, fontSize: 24, color: '#ffffff', textAlign: 'center' },
    meta: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingBottom: 10 },
    chip: { borderWidth: 2, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4 },
    chipText: { fontFamily: FONT_BOLD, fontSize: 17 },
    tabs: { flexDirection: 'row', gap: 6, marginHorizontal: 16, padding: 5, borderRadius: 14, borderWidth: 2, borderColor: t.line, backgroundColor: t.surface },
    tab: { flex: 1, minHeight: 50, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
    tabOn: { backgroundColor: t.ink },
    tabText: { fontFamily: FONT_BOLD, fontSize: 19, color: t.ink },
    tabTextOn: { color: t.bg },
    readingWrap: { paddingHorizontal: 18, paddingVertical: 16 },
    reading: { fontFamily: FONT, color: t.ink },
    now: { backgroundColor: t.hl },
    sizeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16, paddingTop: 8 },
    sizeBtn: { width: 72, height: 56, borderRadius: 14, borderWidth: 2, borderColor: t.line, backgroundColor: t.surface, alignItems: 'center', justifyContent: 'center' },
    sizeBtnText: { fontFamily: FONT_BOLD, color: t.ink },
    sizeLabel: { fontFamily: FONT, fontSize: 18, color: t.muted },
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
    sheet: { maxHeight: '90%', backgroundColor: t.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, borderWidth: 2, borderColor: t.line },
    label: { fontFamily: FONT_BOLD, fontSize: 20, color: t.ink },
    hintSmall: { fontFamily: FONT, fontSize: 16, color: t.muted, marginTop: -8 },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    opt: { minHeight: 52, paddingHorizontal: 16, borderRadius: 12, borderWidth: 2, borderColor: t.line, backgroundColor: t.bg, justifyContent: 'center' },
    optOn: { backgroundColor: t.ink, borderColor: t.ink },
    optText: { fontFamily: FONT_BOLD, fontSize: 18, color: t.ink },
    optTextOn: { color: t.bg },
    switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52 },
  });
}
