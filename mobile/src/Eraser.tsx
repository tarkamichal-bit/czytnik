import { useMemo, useRef, useState } from 'react';
import { Image, LayoutChangeEvent, Modal, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';
import Reader, { SavedPage } from '../modules/reader-mlkit/src/ReaderMlkitModule';
import { FONT, FONT_BOLD, Theme } from './shared';

type Props = {
  t: Theme;
  image: SavedPage | null;
  onDone: (edited: SavedPage) => void;
  onCancel: () => void;
};

// brush width as a share of the longer side of the photo
const BRUSHES = [
  { label: 'Cienka', k: 0.025 },
  { label: 'Średnia', k: 0.05 },
  { label: 'Gruba', k: 0.1 },
];

/** "Gumka": the user paints over the part of the photo that should not be read; it becomes white. */
export default function Eraser({ t, image, onDone, onCancel }: Props) {
  const insets = useSafeAreaInsets();
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [strokes, setStrokes] = useState<number[][]>([]);
  const [brushIdx, setBrushIdx] = useState(1);
  const [saving, setSaving] = useState(false);
  const live = useRef<number[] | null>(null);
  const [, redraw] = useState(0);

  const imgW = image?.width ?? 1;
  const imgH = image?.height ?? 1;
  const k = size.w ? Math.min(size.w / imgW, size.h / imgH) : 1;
  const ox = (size.w - imgW * k) / 2;
  const oy = (size.h - imgH * k) / 2;
  const brush = Math.max(imgW, imgH) * BRUSHES[brushIdx].k;

  // the pan responder is created once, so it reads the current geometry from a ref
  const geo = useRef({ k, ox, oy, imgW, imgH, brush });
  geo.current = { k, ox, oy, imgW, imgH, brush };
  const toImage = (x: number, y: number) => {
    const g = geo.current;
    return [Math.max(0, Math.min(g.imgW, (x - g.ox) / g.k)), Math.max(0, Math.min(g.imgH, (y - g.oy) / g.k))];
  };

  // strokes are stored with their brush in front: [brush, x0, y0, x1, y1, ...]
  const finish = () => {
    const s = live.current;
    live.current = null;
    if (s) { const b = geo.current.brush; setStrokes((prev) => [...prev, [b, ...s]]); }
  };

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => {
          live.current = toImage(e.nativeEvent.locationX, e.nativeEvent.locationY);
          redraw((n) => n + 1);
        },
        onPanResponderMove: (e) => {
          const s = live.current;
          if (!s) return;
          const [x, y] = toImage(e.nativeEvent.locationX, e.nativeEvent.locationY);
          const lx = s[s.length - 2], ly = s[s.length - 1];
          if ((x - lx) ** 2 + (y - ly) ** 2 < 16) return;
          s.push(x, y);
          redraw((n) => n + 1);
        },
        onPanResponderRelease: () => finish(),
        onPanResponderTerminate: () => finish(),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const all = live.current ? [...strokes, [brush, ...live.current]] : strokes;

  const save = async () => {
    if (!image) return;
    if (!strokes.length) { onCancel(); return; }
    setSaving(true);
    try {
      // one native call per brush size; strokes of the same size go together
      let cur: SavedPage = image;
      const sizes = [...new Set(strokes.map((st) => st[0]))];
      for (const b of sizes) {
        const pts: number[] = [];
        const counts: number[] = [];
        for (const st of strokes) {
          if (st[0] !== b) continue;
          const p = st.slice(1);
          pts.push(...p);
          counts.push(p.length / 2);
        }
        cur = await Reader.erase(cur.uri, pts, counts, b);
      }
      setStrokes([]);
      onDone(cur);
    } catch {
      onCancel();
    } finally {
      setSaving(false);
    }
  };

  const close = () => { setStrokes([]); onCancel(); };
  const c = styles(t);

  return (
    <Modal visible={!!image} animationType="fade" onRequestClose={close}>
      <View style={[c.root, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 12 }]}>
        <Text style={c.title}>Gumka</Text>
        <Text style={c.hint}>Zamaż palcem to, czego nie trzeba czytać.</Text>
        <View style={c.canvas} onLayout={(e: LayoutChangeEvent) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })} {...responder.panHandlers}>
          {image && size.w > 0 && (
            <View pointerEvents="none" style={StyleSheet.absoluteFill}>
              <Image source={{ uri: image.uri }} style={{ position: 'absolute', left: ox, top: oy, width: imgW * k, height: imgH * k }} />
              <Svg style={{ position: 'absolute', left: ox, top: oy }} width={imgW * k} height={imgH * k} viewBox={`0 0 ${imgW} ${imgH}`}>
                {all.map((st, i) => {
                  const b = st[0];
                  const p = st.slice(1);
                  if (p.length === 2) return <Circle key={i} cx={p[0]} cy={p[1]} r={b / 2} fill="#fff" opacity={0.92} />;
                  let d = `M${p[0]} ${p[1]}`;
                  for (let j = 2; j < p.length; j += 2) d += ` L${p[j]} ${p[j + 1]}`;
                  return <Path key={i} d={d} stroke="#fff" strokeWidth={b} strokeLinecap="round" strokeLinejoin="round" fill="none" opacity={0.92} />;
                })}
              </Svg>
            </View>
          )}
        </View>
        <View style={c.row}>
          {BRUSHES.map((x, i) => (
            <Pressable key={x.label} style={[c.chip, brushIdx === i && c.chipOn]} onPress={() => setBrushIdx(i)} accessibilityRole="button" accessibilityState={{ selected: brushIdx === i }}>
              <Text style={[c.chipText, brushIdx === i && c.chipTextOn]}>{x.label}</Text>
            </Pressable>
          ))}
        </View>
        <View style={c.row}>
          <Pressable style={c.btn} onPress={close} accessibilityRole="button"><Text style={c.btnText}>Anuluj</Text></Pressable>
          <Pressable style={[c.btn, !strokes.length && c.off]} disabled={!strokes.length} onPress={() => setStrokes((p) => p.slice(0, -1))} accessibilityRole="button"><Text style={c.btnText}>Cofnij</Text></Pressable>
          <Pressable style={[c.btn, c.btnMain, saving && c.off]} disabled={saving} onPress={save} accessibilityRole="button">
            <Text style={[c.btnText, c.btnMainText]}>{saving ? 'Zapisuję…' : 'Gotowe'}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function styles(t: Theme) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: '#0d1424', paddingHorizontal: 16, gap: 10 },
    title: { fontFamily: FONT_BOLD, fontSize: 28, color: '#fff' },
    hint: { fontFamily: FONT, fontSize: 19, color: '#cfd6e6' },
    canvas: { flex: 1, borderRadius: 16, overflow: 'hidden', backgroundColor: '#000' },
    row: { flexDirection: 'row', gap: 10 },
    chip: { flex: 1, minHeight: 52, borderRadius: 14, borderWidth: 2, borderColor: '#cfd6e6', alignItems: 'center', justifyContent: 'center' },
    chipOn: { backgroundColor: t.lens, borderColor: t.lens },
    chipText: { fontFamily: FONT_BOLD, fontSize: 18, color: '#fff' },
    chipTextOn: { color: t.lensInk },
    btn: { flex: 1, minHeight: 68, borderRadius: 18, borderWidth: 3, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
    btnMain: { backgroundColor: t.lens, borderColor: t.lens },
    btnText: { fontFamily: FONT_BOLD, fontSize: 20, color: '#fff' },
    btnMainText: { color: t.lensInk },
    off: { opacity: 0.4 },
  });
}
