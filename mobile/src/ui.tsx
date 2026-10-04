import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { FONT, FONT_BOLD, Theme } from './shared';

// ---------- small components ----------
export type S = ReturnType<typeof makeStyles>;

export function BigButton({ s, label, onPress, disabled, flex }: { s: S; label: string; onPress: () => void; disabled?: boolean; flex?: boolean }) {
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

export function Option({ s, label, on, onPress }: { s: S; label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable style={[s.opt, on && s.optOn]} onPress={onPress} accessibilityRole="radio" accessibilityState={{ selected: on }}>
      <Text style={[s.optText, on && s.optTextOn]}>{label}</Text>
    </Pressable>
  );
}

export function Chip({ s, text, color }: { s: S; text: string; color: string }) {
  return (
    <View style={[s.chip, { borderColor: color }]}>
      <Text style={[s.chipText, { color }]}>{text}</Text>
    </View>
  );
}

export function BusyOverlay({ s, text, t }: { s: S; text: string; t: Theme }) {
  return (
    <View style={s.busy}>
      <ActivityIndicator size="large" color={t.lens} />
      <Text style={s.busyText}>{text}</Text>
    </View>
  );
}

// ---------- styles ----------
export function makeStyles(t: Theme) {
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
