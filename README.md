# Czytnik z lektorem

PWA: zdjęcie tekstu → rozpoznanie (Tesseract.js 7) → tłumaczenie (MyMemory) → lektor (Web Speech API).

- Aplikacja: https://tarkamichal-bit.github.io/czytnik/ (na telefonie: „Dodaj do ekranu głównego”)
- Źródło: `src/app.html`. Po zmianach: `sh build.sh`, commit, push. Pages serwuje `main` / root.
- W podglądzie Claude (Artifact) rozpoznawanie i tłumaczenie robi Claude; w tej wersji działa Tesseract + MyMemory.
