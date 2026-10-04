import { RefObject, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { CameraView } from 'expo-camera';
import { Text } from './Text';
import { FONT_BOLD } from './shared';

type Props = {
  cameraRef: RefObject<CameraView | null>;
  torch: boolean;
  onReady: (ready: boolean) => void;
};

/**
 * The live camera preview. Android sometimes shows a black preview when a camera view is mounted
 * right after another one was closed, so the preview is mounted with a short delay and restarted
 * when it does not report "ready" in time (or when the user taps the black area).
 */
export default function Camera({ cameraRef, torch, onReady }: Props) {
  const [mounted, setMounted] = useState(false);
  const [key, setKey] = useState(0);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const retries = useRef(0);

  useEffect(() => {
    const id = setTimeout(() => setMounted(true), 300);
    return () => { clearTimeout(id); onReady(false); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // watchdog: no "ready" within 3.5 s -> mount a fresh preview (twice at most, then ask for a tap)
  useEffect(() => {
    if (!mounted || ready) return;
    const id = setTimeout(() => {
      if (retries.current < 2) { retries.current++; setKey((k) => k + 1); }
      else setFailed(true);
    }, 3500);
    return () => clearTimeout(id);
  }, [mounted, ready, key]);

  const restart = () => {
    retries.current = 0;
    setFailed(false);
    setReady(false);
    onReady(false);
    setKey((k) => k + 1);
  };

  return (
    <View style={StyleSheet.absoluteFill}>
      {mounted && (
        <CameraView
          key={key}
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing="back"
          autofocus="on"
          enableTorch={torch}
          onCameraReady={() => { setReady(true); setFailed(false); onReady(true); }}
          onMountError={() => setFailed(true)}
        />
      )}
      {!ready && (
        <Pressable style={c.wait} onPress={restart} accessibilityRole="button" accessibilityLabel="Uruchom aparat ponownie">
          {failed ? null : <ActivityIndicator size="large" color="#ffd23f" />}
          <Text style={c.waitText}>{failed ? 'Aparat się nie uruchomił.\nDotknij, aby spróbować ponownie.' : 'Uruchamiam aparat…'}</Text>
        </Pressable>
      )}
    </View>
  );
}

const c = StyleSheet.create({
  wait: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 20 },
  waitText: { fontFamily: FONT_BOLD, fontSize: 18, color: '#fff', textAlign: 'center' },
});
