#!/usr/bin/env sh
# Wraps src/studio.html (artifact-style page content) into a standalone index.html.
set -e
cd "$(dirname "$0")/.."
{
  printf '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
  printf '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
  printf '</head>\n<body>\n'
  cat src/studio.html
  printf '\n</body>\n</html>\n'
} > index.html
echo "Built index.html"
