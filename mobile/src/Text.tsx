import { Text as RNText, TextInput as RNTextInput, TextInputProps, TextProps } from 'react-native';

// The app already uses large letters; a large system font size on top of that wraps button
// labels into many lines, so system scaling is capped.
const MAX_SCALE = 1.15;

export function Text(p: TextProps) {
  return <RNText maxFontSizeMultiplier={MAX_SCALE} {...p} />;
}
export function TextInput(p: TextInputProps) {
  return <RNTextInput maxFontSizeMultiplier={MAX_SCALE} {...p} />;
}
