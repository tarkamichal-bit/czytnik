import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, G, Line } from 'react-native-svg';

// Soft "reading glass" backdrop: warm paper gradient, a few large lens rings and faint text lines.
export default function Background({ contrast }: { contrast: boolean }) {
  if (contrast) return <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }]} />;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <LinearGradient
        colors={['#fff6d8', '#f5f3ee', '#e3ecff']}
        locations={[0, 0.5, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <Svg width="100%" height="100%" viewBox="0 0 400 800" preserveAspectRatio="xMidYMid slice">
        <G opacity={0.10} stroke="#14213d" strokeLinecap="round">
          {Array.from({ length: 22 }, (_, i) => (
            <Line key={i} x1={24} x2={24 + 140 + ((i * 53) % 190)} y1={40 + i * 34} y2={40 + i * 34} strokeWidth={6} />
          ))}
        </G>
        <Circle cx={330} cy={120} r={95} fill="#ffd23f" opacity={0.28} />
        <Circle cx={330} cy={120} r={95} fill="none" stroke="#14213d" strokeWidth={10} opacity={0.08} />
        <Circle cx={60} cy={560} r={140} fill="#8fb3ff" opacity={0.18} />
        <Circle cx={360} cy={720} r={70} fill="#ffd23f" opacity={0.22} />
      </Svg>
    </View>
  );
}
