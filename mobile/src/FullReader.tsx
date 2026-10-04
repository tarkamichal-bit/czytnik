import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, LayoutChangeEvent, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Box, OcrWord } from '../modules/reader-mlkit/src/ReaderMlkitModule';
import { FONT_BOLD, Theme, Token, shift } from './shared';
import { OverlayButton, S } from './ui';
import Icon from './Icon';

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
  const [zoomNow, setZoomNow] = useState(1);
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
    const x = shift(size.w / 2 - z * cx, size.w, W, z);
    const y = shift(size.h / 2 - z * cy, size.h, H, z);
    setZoomNow(z);
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
              transform: [{ translateX: tx }, { translateY: ty }, { scale: zoom }],
            }}
          >
            {/* full resolution (no downscaled decode), so letters stay sharp when zoomed in */}
            <Image source={{ uri: p.photoUri }} style={StyleSheet.absoluteFill} resizeMethod="scale" />
            {p.segments.map((g, i) =>
              g.box ? (
                <Pressable
                  key={i}
                  onPress={() => p.onTap(i)}
                  accessibilityRole="button"
                  accessibilityLabel={`Czytaj od fragmentu ${i + 1}`}
                  style={[p.s.segBox, place(g.box, 4 / zoomNow), { borderWidth: 1.5 / zoomNow }, p.current === i && [p.s.segBoxNow, { borderWidth: 2 / zoomNow }]]}
                />
              ) : null,
            )}
            {p.wordBox && (
              <View pointerEvents="none" style={[p.s.wordBox, place(p.wordBox, 1 / zoomNow), { borderWidth: 1.5 / zoomNow, borderRadius: 3 / zoomNow }]} />
            )}
          </Animated.View>
        )}
        <OverlayButton s={p.s} icon="shrink" label="Zamknij pełny ekran" onPress={p.onSplit} pos={{ right: 10, top: 10 }} />
      </View>


      <View style={c.bar}>
        <Pressable style={c.btn} onPress={p.onNew} accessibilityRole="button" accessibilityLabel="Nowe zdjęcie">
          <Icon name="camera" size={24} color="#fff" />
          <Text style={c.btnText}>Nowe</Text>
        </Pressable>
        <Pressable style={c.btn} onPress={p.onErase} accessibilityRole="button" accessibilityLabel="Gumka">
          <Icon name="eraser" size={24} color="#fff" />
          <Text style={c.btnText}>Gumka</Text>
        </Pressable>
        <Pressable style={[c.btn, c.main, p.playing && c.mainOn]} onPress={p.onPlayStop} accessibilityRole="button">
          <Icon name={p.playing ? 'stop' : 'play'} size={24} color={p.t.lensInk} />
          <Text style={[c.mainText]}>{p.playing ? 'Stop' : 'Czytaj'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function styles(t: Theme) {
  return StyleSheet.create({
    root: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: '#0d1424', paddingHorizontal: 10, gap: 8 },
    viewer: { flex: 1, borderRadius: 14, overflow: 'hidden', backgroundColor: '#000' },
    bar: { flexDirection: 'row', gap: 8 },
    btn: { width: 72, minHeight: 60, borderRadius: 16, borderWidth: 1.5, borderColor: 'rgba(207,214,230,0.6)', alignItems: 'center', justifyContent: 'center', gap: 2 },
    btnText: { fontFamily: FONT_BOLD, fontSize: 12, color: '#fff', textAlign: 'center' },
    main: { flex: 1, width: undefined, flexDirection: 'row', gap: 8, backgroundColor: t.lens, borderColor: t.lens },
    mainOn: { backgroundColor: '#fff', borderColor: '#fff' },
    mainText: { fontFamily: FONT_BOLD, color: t.lensInk, fontSize: 19 },
  });
}
