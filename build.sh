#!/bin/sh
# Склеивает движок и код заставки в один файл плагина: dist/lampa-ascii-koi.js
set -e
cd "$(dirname "$0")"
mkdir -p dist
{
  echo "/* lampa-ascii-koi — заставка для Lampa. Движок: $(cat vendor/ascii-life-engine/VERSION), MIT. */"
  cat vendor/ascii-life-engine/ascii-life.js
  echo
  cat src/screensaver.js
} > dist/lampa-ascii-koi.js
echo "dist/lampa-ascii-koi.js: $(wc -c < dist/lampa-ascii-koi.js | tr -d ' ') байт"
