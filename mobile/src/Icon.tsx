import Svg, { Circle, Path, Rect } from 'react-native-svg';

export type IconName = 'play' | 'stop' | 'prev' | 'next' | 'camera' | 'expand' | 'shrink' | 'eraser' | 'back' | 'torch' | 'list' | 'plus';

/** Simple line icons (24×24 grid) so buttons need only a short label. */
export default function Icon({ name, size = 28, color = '#14213d' }: { name: IconName; size?: number; color?: string }) {
  const p = { stroke: color, strokeWidth: 2.4, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === 'play' && <Path d="M7 4.5v15l12-7.5z" fill={color} stroke={color} strokeWidth={1.5} strokeLinejoin="round" />}
      {name === 'stop' && <Rect x={6} y={6} width={12} height={12} rx={2} fill={color} />}
      {name === 'prev' && <Path d="M15 5l-7 7 7 7" {...p} />}
      {name === 'next' && <Path d="M9 5l7 7-7 7" {...p} />}
      {name === 'back' && <Path d="M20 12H5m6-6l-6 6 6 6" {...p} />}
      {name === 'camera' && (
        <>
          <Path d="M3.5 8.5a2 2 0 012-2h2l1.5-2h6l1.5 2h2a2 2 0 012 2v9a2 2 0 01-2 2h-13a2 2 0 01-2-2z" {...p} />
          <Circle cx={12} cy={13} r={3.6} {...p} />
        </>
      )}
      {name === 'expand' && <Path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" {...p} />}
      {name === 'shrink' && <Path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" {...p} />}
      {name === 'eraser' && (
        <>
          <Path d="M14.5 4.5l5 5-9 9h-5l-2.5-2.5a1.5 1.5 0 010-2.1z" {...p} />
          <Path d="M10 9l5 5M10.5 18.5H20" {...p} />
        </>
      )}
      {name === 'torch' && <Path d="M8 3h8l-1.5 5v12h-5V8zM12 12v2" {...p} />}
      {name === 'list' && <Path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" {...p} />}
      {name === 'plus' && <Path d="M12 5v14M5 12h14" {...p} />}
    </Svg>
  );
}
