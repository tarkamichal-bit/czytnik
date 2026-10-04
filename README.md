# Czytnik z lektorem

PWA: zdjęcie tekstu → rozpoznanie (Tesseract.js 7) → tłumaczenie (MyMemory) → lektor (Web Speech API).

- Aplikacja: https://tarkamichal-bit.github.io/czytnik/ (na telefonie: „Dodaj do ekranu głównego”)
- Źródło: `src/app.html`. Po zmianach: `sh build.sh`, commit, push. Pages serwuje `main` / root.
- W podglądzie Claude (Artifact) rozpoznawanie i tłumaczenie robi Claude; w tej wersji działa Tesseract + MyMemory.

## Aplikacja na Androida (`mobile/`)

Expo SDK 57 + własny moduł `modules/reader-mlkit` (Kotlin, Google ML Kit: rozpoznawanie tekstu, wykrywanie języka, tłumaczenie w telefonie) + `expo-speech` (lektor).

- APK budowany w GitHub Actions (`.github/workflows/android.yml`) przy każdym pushu do `mobile/`; gotowy plik: Releases → `latest` → `czytnik.apk`.
- Lokalnie: `cd mobile && npm ci && npx expo run:android` (wymaga Android SDK).
- `android/` jest generowany (`npx expo prebuild`), nie edytuj go ręcznie.
