#!/usr/bin/env bash
# Rebuilds the Setup's Hemisphere window (NSIS plugin) and its background picture into build/.
# Run from WSL/Linux. Needs ImageMagick and Zig (no admin rights: python3 -m pip install ziglang).
set -euo pipefail
cd "$(dirname "$0")/../.."
ZIG="${ZIG:-python3 -m ziglang}"

mkdir -p build/x86-unicode
$ZIG cc -target x86-windows-gnu -O2 -s -shared -Wall -Wextra -o build/x86-unicode/HemiSplash.dll \
  tools/installer-splash/HemiSplash.c -lgdi32 -lmsimg32 -luser32 -lkernel32
rm -f build/x86-unicode/HemiSplash.lib build/x86-unicode/HemiSplash.pdb

# 2x the window (520x300): Hemisphere artwork, darkened towards the bottom, with the logo
convert src/renderer/src/assets/backgrounds/kingdom.webp -resize 1040x600^ -gravity center -extent 1040x600 -blur 0x3 \
  \( -size 1040x600 gradient:'rgba(11,15,25,0.55)-rgba(11,15,25,0.93)' \) -compose over -composite \
  \( build/icon.png -resize 168x168 \( +clone -background black -shadow 60x10+0+6 \) +swap -background none -layers merge +repage \) \
  -gravity north -geometry +0+70 -compose over -composite \
  -alpha off -type truecolor BMP3:build/installerSplash.bmp
echo "build/x86-unicode/HemiSplash.dll and build/installerSplash.bmp ready"
