#!/bin/sh
# Build the live site: copy only the files the game and the tuner need into public/
# (or $OUT), and stamp index.html with the commit so phones fetch fresh files.
# Render runs this for the static site (see render.yaml). Design notes, the old one-file
# game, tests and the score server stay in the repo but are not published.
# Plain POSIX sh and sed, no sed -i, so it runs the same on Linux and macOS.
set -eu
OUT="${OUT:-public}"
VERSION="${RENDER_GIT_COMMIT:-dev}"
GAME_FILES="index.html styles.css config.js storage.js sound.js art.js save.js scores-client.js game-logic.js app.js"
TOOL_FILES="tools/tuner.html tools/tuner-core.js"

rm -rf "$OUT"
mkdir -p "$OUT/tools"
for f in $GAME_FILES $TOOL_FILES; do
  cp "$f" "$OUT/$f"
done
sed "s/__V__/$VERSION/g" index.html > "$OUT/index.html"
echo "Built $OUT/ ($VERSION)"
