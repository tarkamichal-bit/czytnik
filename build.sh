#!/bin/sh
# Builds the deployable PWA into the repo root (served by GitHub Pages from main / root).
set -e
cd "$(dirname "$0")"
{
  printf '<!doctype html>\n<html lang="pl">\n<head>\n<meta charset="utf-8">\n'
  printf '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n'
  printf '<meta name="theme-color" content="#14213d">\n<meta name="apple-mobile-web-app-capable" content="yes">\n'
  printf '<link rel="manifest" href="manifest.webmanifest">\n<link rel="icon" href="icon.svg">\n<link rel="apple-touch-icon" href="icon-192.png">\n'
  printf '</head>\n<body>\n'
  cat src/app.html
  printf '\n</body>\n</html>\n'
} > index.html
cp src/manifest.webmanifest src/sw.js src/icon.svg src/icon-192.png src/icon-512.png .
echo "index.html ready"
