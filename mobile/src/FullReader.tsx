import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Box, OcrWord } from '../modules/reader-mlkit/src/ReaderMlkitModule';
import { FONT, FONT_BOLD, Theme, Token } from './shared';
import { S } from './ui';

type Seg = { box?: Box; words: OcrWord[] };
type Props = {
  s: S;
  t: Theme;
  photoUri: string;
  imgW: number;
  imgH: number;
  segments: Seg[];
  current: number | null;
  wordBox: Box | null;
  tokens: Token[];
  token: number | null;
  playing: boolean;
  onTap: (seg: number) => void;
  onPlayStop: () => void;
  onSplit: () => void;
  onNew: () => void;
  onErase: () => void;
};

const MAX_ZOOM = 3.5;

/** The photo over the whole screen: the view glides to the fragment being read and follows its lines. */
export default function FullReader(p: Props) {
  const insets = useSafeAreaInsets();
  const [size, setSize] = useState({ w: 0, h: 0 });
  const zoom = useRef(new Animated.Value(1)).current;
  const tx = useRef(new Animated.Value(0)).current;
  const ty = useRef(new Animated.Value(0)).current;
  const base = size.w ? Math.min(size.w / p.imgW, size.h / p.imgH) : 1;
  const W = p.imgW * base;
  const H = p.imgH * base;

  const seg = p.current !== null ? p.segments[p.current] : null;
  const box = seg?.box ?? null;
  // re-aim when the fragment changes or the voice moves to another line of it
  const lineKey = p.wordBox ? Math.round(p.wordBox.top / Math.max(1, p.wordBox.height * 0.8)) : -1;

  useEffect(() => {
    if (!size.w) return;
    let z = 1;
    let cx = W / 2;
    let cy = H / 2;
    if (box) {
      const bw = box.width * base;
      const bh = box.height * base;
      z = Math.max(1, Math.min(MAX_ZOOM, (size.w / bw) * 0.92));
      cx = (box.left + box.width / 2) * base;
      cy = (box.top + box.height / 2) * base;
      if (bh * z > size.h * 0.9) {
        // a tall paragraph: keep the zoom and follow the line being read
        if (p.wordBox) cy = (p.wordBox.top + p.wordBox.height / 2) * base;
        else z = Math.max(1, (size.h * 0.9) / bh);
      }
    }
    // keep the photo on screen: no empty margins beyond its edges
    const clamp = (v: number, view: number, content: number) => (content <= view ? (view - content) / 2 : Math.min(0, Math.max(view - content, v)));
    const x = clamp(size.w / 2 - z * cx, size.w, W * z);
    const y = clamp(size.h / 2 - z * cy, size.h, H * z);
    const cfg = { duration: 450, easing: Easing.inOut(Easing.cubic), useNativeDriver: true };
    Animated.parallel([
      Animated.timing(zoom, { toValue: z, ...cfg }),
      Animated.timing(tx, { toValue: x, ...cfg }),
      Animated.timing(ty, { toValue: y, ...cfg }),
    ]).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.w, size.h, p.current, lineKey, p.photoUri]);

  const place = (b: Box, pad = 0) => ({ left: b.left * base - pad, top: b.top * base - pad, width: b.width * base + 2 * pad, height: b.height * base + 2 * pad });
  const c = styles(p.t);

  return (
    <View style={[c.root, { paddingTop: insets.top + 6, paddingBottom: insets.bottom + 10 }]}>
      <View style={c.viewer} onLayout={(e: LayoutChangeEvent) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
        {size.w > 0 && (
          <Animated.View
            style={{
              position: 'absolute', left: 0, top: 0, width: W, height: H,
              transformOrigin: 'top left',
              transform: [{ translateX: tx }, { translateY: ty }, { scale: zoom }],
            }}
          >
            <Image source={{ uri: p.photoUri }} style={StyleSheet.absoluteFill} />
            {p.segments.map((g, i) =>
              g.box ? (
                <Pressable
                  key={i}
                  onPress={() => p.onTap(i)}
                  accessibilityRole="button"
                  accessibilityLabel={`Czytaj od fragmentu ${i + 1}`}
                  style={[p.s.segBox, place(g.box, 4), p.current === i && p.s.segBoxNow]}
                />
              ) : null,
            )}
            {p.wordBox && <View pointerEvents="none" style={[p.s.wordBox, place(p.wordBox, 3)]} />}
          </Animated.View>
        )}
      </View>

      <Text style={c.caption} numberOfLines={2}>
        {p.tokens.map((tk, i) => (
          <Text key={i} style={p.token === i ? p.s.now : undefined}>{tk.text}{i < p.tokens.length - 1 ? ' ' : ''}</Text>
        ))}
      </Text>

      <View style={c.bar}>
        <Pressable style={c.btn} onPress={p.onSplit} accessibilityRole="button" accessibilityLabel="Pokaż obraz i tekst">
          <Text style={c.btnText}>Obraz{'\n'}i tekst</Text>
        </Pressable>
        <Pressable style={c.btn} onPress={p.onErase} accessibilityRole="button" accessibilityLabel="Gumka">
          <Text style={c.btnText}>Gumka</Text>
        </Pressable>
        <Pressable style={c.btn} onPress={p.onNew} accessibilityRole="button">
          <Text style={c.btnText}>Nowe{'\n'}zdjęcie</Text>
        </Pressable>
        <Pressable style={[c.btn, c.main, p.playing && c.mainOn]} onPress={p.onPlayStop} accessibilityRole="button">
          <Text style={[c.btnText, c.mainText]}>{p.playing ? 'Stop' : 'Czytaj'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function styles(t: Theme) {
  return StyleSheet.create({
    root: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: '#0d1424', paddingHorizontal: 10, gap: 8 },
    viewer: { flex: 1, borderRadius: 14, overflow: 'hidden', backgroundColor: '#000' },
    caption: { fontFamily: FONT, fontSize: 22, lineHeight: 30, color: '#fff', minHeight: 60, paddingHorizontal: 6 },
    bar: { flexDirection: 'row', gap: 8 },
    btn: { flex: 1, minHeight: 64, borderRadius: 16, borderWidth: 2, borderColor: '#cfd6e6', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
    btnText: { fontFamily: FONT_BOLD, fontSize: 16, color: '#fff', textAlign: 'center' },
    main: { flex: 1.3, backgroundColor: t.lens, borderColor: t.lens },
    mainOn: { backgroundColor: '#fff', borderColor: '#fff' },
    mainText: { color: t.lensInk, fontSize: 20 },
  });
}
