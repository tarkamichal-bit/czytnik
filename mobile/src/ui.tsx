import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { FONT, FONT_BOLD, Theme } from './shared';
import Icon, { IconName } from './Icon';

// ---------- small components ----------
export type S = ReturnType<typeof makeStyles>;

export function BigButton({ s, label, onPress, disabled, flex, icon, t }: { s: S; label: string; onPress: () => void; disabled?: boolean; flex?: boolean; icon?: IconName; t?: Theme }) {
  return (
    <Pressable
      style={({ pressed }) => [s.big, flex && { flex: 1 }, disabled && { opacity: 0.5 }, pressed && { transform: [{ scale: 0.98 }] }]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {icon && <Icon name={icon} size={24} color={t?.lensInk ?? '#14213d'} />}
      <Text style={s.bigText} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

/** Square button: icon with a one-word label under it. */
export function IconButton({ s, t, icon, label, onPress, disabled, on }: { s: S; t: Theme; icon: IconName; label: string; onPress: () => void; disabled?: boolean; on?: boolean }) {
  return (
    <Pressable
      style={({ pressed }) => [s.iconBtn, on && { backgroundColor: t.ink, borderColor: t.ink }, disabled && { opacity: 0.4 }, pressed && { transform: [{ scale: 0.96 }] }]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Icon name={icon} size={24} color={on ? t.bg : t.ink} />
      <Text style={[s.iconBtnText, on && { color: t.bg }]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

/** Round button floating over a photo (e.g. full screen on/off, like in a video player). */
export function OverlayButton({ s, icon, label, onPress, pos }: { s: S; icon: IconName; label: string; onPress: () => void; pos: { top?: number; right?: number; bottom?: number; left?: number } }) {
  return (
    <Pressable style={[s.overlayBtn, pos]} onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={8}>
      <Icon name={icon} size={24} color="#fff" />
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
    iconBtn: { minWidth: 64, minHeight: 60, borderRadius: 16, borderWidth: 2, borderColor: t.line, backgroundColor: t.surface, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, gap: 2 },
    iconBtnText: { fontFamily: FONT_BOLD, fontSize: 12, color: t.ink, textAlign: 'center' },
    overlayBtn: { position: 'absolute', width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(13,20,36,0.72)', alignItems: 'center', justifyContent: 'center' },
    center: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 6 },
    h1: { fontFamily: FONT_BOLD, fontSize: 24, color: t.ink },
    h2: { fontFamily: FONT_BOLD, fontSize: 22, color: t.ink },
    body: { fontFamily: FONT, fontSize: 19, color: t.ink },
    smallBtn: { minHeight: 42, paddingHorizontal: 14, borderRadius: 12, borderWidth: 2, borderColor: t.line, backgroundColor: t.surface, justifyContent: 'center' },
    smallBtnText: { fontFamily: FONT_BOLD, fontSize: 15, color: t.ink },
    lens: { flex: 1, minHeight: 200, marginHorizontal: 12, marginTop: 8, borderRadius: 18, overflow: 'hidden', borderWidth: 2, borderColor: t.ink, backgroundColor: '#111' },
    lensReading: { flex: 1.4 },
    frameGuide: { position: 'absolute', borderWidth: 4, borderColor: 'rgba(255,210,63,0.95)', borderRadius: 14 },
    segBox: { position: 'absolute', borderWidth: 2, borderColor: 'rgba(255,210,63,0.75)', borderRadius: 8 },
    segBoxNow: { borderWidth: 3, borderColor: '#ffd23f', backgroundColor: 'rgba(255,210,63,0.22)' },
    wordBox: { position: 'absolute', borderWidth: 1.5, borderColor: '#e63946', borderRadius: 3, backgroundColor: 'rgba(255,233,138,0.22)' },
    hint: { fontFamily: FONT, fontSize: 16, color: t.muted, textAlign: 'center', paddingHorizontal: 16, paddingTop: 8 },
    error: { fontFamily: FONT_BOLD, fontSize: 16, color: t.warn, paddingHorizontal: 16, paddingTop: 6 },
    bar: { flexDirection: 'row', alignItems: 'stretch', gap: 8, paddingHorizontal: 12, paddingTop: 10, marginTop: 6 },
    big: { minHeight: 60, borderRadius: 18, borderWidth: 2, borderColor: t.ink, backgroundColor: t.lens, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, flexDirection: 'row', gap: 8 },
    bigText: { fontFamily: FONT_BOLD, fontSize: 19, color: t.lensInk, textAlign: 'center' },
    secondary: { backgroundColor: t.surface },
    pressed: { backgroundColor: t.ink },
    pressedText: { color: t.bg },
    busy: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(13,20,36,0.75)', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 20 },
    busyText: { fontFamily: FONT_BOLD, fontSize: 19, color: '#ffffff', textAlign: 'center' },
    meta: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 4 },
    chip: { borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, backgroundColor: t.surface },
    chipText: { fontFamily: FONT_BOLD, fontSize: 13 },
    tabs: { flexDirection: 'row', gap: 4, marginHorizontal: 12, padding: 4, borderRadius: 14, borderWidth: 1.5, borderColor: t.line, backgroundColor: t.surface },
    tab: { flex: 1, minHeight: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
    tabOn: { backgroundColor: t.ink },
    tabText: { fontFamily: FONT_BOLD, fontSize: 16, color: t.ink },
    tabTextOn: { color: t.bg },
    readingWrap: { paddingHorizontal: 16, paddingVertical: 8, gap: 6 },
    reading: { fontFamily: FONT, color: t.ink },
    now: { backgroundColor: t.hl },
    sizeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14, paddingTop: 2 },
    sizeBtn: { width: 60, height: 42, borderRadius: 12, borderWidth: 2, borderColor: t.line, backgroundColor: t.surface, alignItems: 'center', justifyContent: 'center' },
    sizeBtnText: { fontFamily: FONT_BOLD, color: t.ink },
    sizeLabel: { fontFamily: FONT, fontSize: 15, color: t.muted },
    usage: { paddingHorizontal: 12, paddingTop: 4 },
    usageText: { fontFamily: FONT, fontSize: 12, color: t.muted, textAlign: 'center', fontVariant: ['tabular-nums'] },
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
    sheet: { maxHeight: '92%', backgroundColor: t.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, borderWidth: 2, borderColor: t.line },
    label: { fontFamily: FONT_BOLD, fontSize: 17, color: t.ink },
    hintSmall: { fontFamily: FONT, fontSize: 14, color: t.muted },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    opt: { minHeight: 44, paddingHorizontal: 14, borderRadius: 12, borderWidth: 2, borderColor: t.line, backgroundColor: t.surface, justifyContent: 'center' },
    optOn: { backgroundColor: t.ink, borderColor: t.ink },
    optText: { fontFamily: FONT_BOLD, fontSize: 15, color: t.ink },
    optTextOn: { color: t.bg },
    input: { minHeight: 48, borderRadius: 12, borderWidth: 2, borderColor: t.line, backgroundColor: t.surface, paddingHorizontal: 14, fontFamily: FONT, fontSize: 16, color: t.ink },
    switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
  });
}
