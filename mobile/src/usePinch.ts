import { RefObject, useMemo, useRef } from 'react';
import { Animated, GestureResponderEvent, PanResponder, View } from 'react-native';

/** Current target of the zoom/pan values; kept up to date by whoever animates them. */
export type ViewState = { z: number; x: number; y: number };

type Opts = {
  zoom: Animated.Value;
  tx: Animated.Value;
  ty: Animated.Value;
  cur: RefObject<ViewState>;
  /** the viewer the photo sits in (its top-left = the photo's untransformed top-left) */
  viewer: RefObject<View | null>;
  /** untransformed photo size in the viewer; scaling happens around its centre */
  size: () => { w: number; h: number };
  onEnd?: (s: ViewState) => void;
};

type Touch = { pageX: number; pageY: number };
const mid = (t: readonly Touch[]) => ({ x: (t[0].pageX + t[1].pageX) / 2, y: (t[0].pageY + t[1].pageY) / 2 });
const dist = (t: readonly Touch[]) => Math.hypot(t[0].pageX - t[1].pageX, t[0].pageY - t[1].pageY);

/** Pinch with two fingers to zoom, drag to move the photo. Taps still reach what is on the photo. */
export function usePinch(o: Opts) {
  const ref = useRef(o);
  ref.current = o;
  const origin = useRef({ x: 0, y: 0 });
  const start = useRef<{ n: number; s: ViewState; m: { x: number; y: number }; d: number } | null>(null);

  return useMemo(() => {
    const baseline = (e: GestureResponderEvent) => {
      const t = e.nativeEvent.touches;
      const s = { ...ref.current.cur.current };
      start.current = t.length >= 2
        ? { n: 2, s, m: mid(t), d: Math.max(1, dist(t)) }
        : { n: 1, s, m: { x: t[0]?.pageX ?? 0, y: t[0]?.pageY ?? 0 }, d: 1 };
    };
    const wants = (e: GestureResponderEvent, g: { dx: number; dy: number }) =>
      e.nativeEvent.touches.length >= 2 || Math.abs(g.dx) + Math.abs(g.dy) > 10;
    return PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: wants,
      onMoveShouldSetPanResponderCapture: wants,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        const { zoom, tx, ty } = ref.current;
        zoom.stopAnimation(); tx.stopAnimation(); ty.stopAnimation();
        ref.current.viewer.current?.measure((_x, _y, _w, _h, px, py) => { origin.current = { x: px, y: py }; });
        baseline(e);
      },
      onPanResponderMove: (e) => {
        const t = e.nativeEvent.touches;
        if (!start.current || (t.length >= 2 ? 2 : 1) !== start.current.n) { baseline(e); return; }
        const { s, m, d, n } = start.current;
        const { w, h } = ref.current.size();
        let next: ViewState;
        if (n === 2) {
          // the photo point under the fingers' midpoint stays under it
          const z = Math.max(0.8, Math.min(8, (s.z * dist(t)) / d));
          const m1 = mid(t);
          const cx = w / 2, cy = h / 2;
          const px = cx + (m.x - origin.current.x - s.x - cx) / s.z;
          const py = cy + (m.y - origin.current.y - s.y - cy) / s.z;
          next = { z, x: m1.x - origin.current.x - cx - z * (px - cx), y: m1.y - origin.current.y - cy - z * (py - cy) };
        } else {
          next = { z: s.z, x: s.x + (t[0].pageX - m.x), y: s.y + (t[0].pageY - m.y) };
        }
        ref.current.cur.current = next;
        ref.current.zoom.setValue(next.z);
        ref.current.tx.setValue(next.x);
        ref.current.ty.setValue(next.y);
      },
      onPanResponderRelease: () => { start.current = null; ref.current.onEnd?.(ref.current.cur.current); },
      onPanResponderTerminate: () => { start.current = null; ref.current.onEnd?.(ref.current.cur.current); },
    }).panHandlers;
  }, []);
}
