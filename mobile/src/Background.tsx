import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Defs, G, Path, RadialGradient, Stop } from 'react-native-svg';

// Soft "morning sky over a book" backdrop: warm gradient, blurred light spots, gentle hills of
// pages at the bottom and a few sparkles. Calm enough to keep text and photos in front.
export default function Background({ contrast }: { contrast: boolean }) {
  if (contrast) return <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }]} />;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <LinearGradient
        colors={['#fff4e0', '#fdeef0', '#eaf0ff']}
        locations={[0, 0.55, 1]}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <Svg width="100%" height="100%" viewBox="0 0 400 800" preserveAspectRatio="xMidYMid slice">
        <Defs>
          <RadialGradient id="sun" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor="#ffd23f" stopOpacity={0.55} />
            <Stop offset="1" stopColor="#ffd23f" stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="mint" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor="#7fd6c2" stopOpacity={0.35} />
            <Stop offset="1" stopColor="#7fd6c2" stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="lilac" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor="#b9a7ff" stopOpacity={0.35} />
            <Stop offset="1" stopColor="#b9a7ff" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={330} cy={90} r={190} fill="url(#sun)" />
        <Circle cx={30} cy={430} r={210} fill="url(#mint)" />
        <Circle cx={380} cy={560} r={200} fill="url(#lilac)" />
        {/* open book pages as soft hills */}
        <Path d="M0 700 C 90 655, 160 655, 200 690 C 240 655, 310 655, 400 700 L 400 800 L 0 800 Z" fill="#ffffff" opacity={0.55} />
        <Path d="M0 735 C 100 700, 165 702, 200 728 C 235 702, 300 700, 400 735 L 400 800 L 0 800 Z" fill="#ffe9b0" opacity={0.45} />
        <Path d="M200 690 L 200 800" stroke="#14213d" strokeOpacity={0.06} strokeWidth={2} />
        {/* sparkles */}
        <G fill="#ffffff" opacity={0.9}>
          {[
            [60, 70, 5], [120, 150, 3], [250, 40, 4], [365, 250, 3], [40, 300, 3], [300, 380, 4], [90, 560, 3], [345, 470, 3],
          ].map(([x, y, r], i) => (
            <Path key={i} d={`M${x} ${y - r * 2} Q ${x} ${y} ${x + r * 2} ${y} Q ${x} ${y} ${x} ${y + r * 2} Q ${x} ${y} ${x - r * 2} ${y} Q ${x} ${y} ${x} ${y - r * 2} Z`} />
          ))}
        </G>
      </Svg>
    </View>
  );
}
