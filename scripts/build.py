#!/usr/bin/env python3
"""Assembles the Math Manipulatives page from src/.

Outputs:
  build/artifact.html  page content for the claude.ai artifact (no <html>/<head> wrapper)
  index.html           standalone page
  dist/index.html      copy of index.html for Cloudflare
"""
import os, shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
read = lambda p: open(os.path.join(ROOT, 'src', p), encoding='utf-8').read().strip('\n')

css = '\n'.join(read(p) for p in ['base.css', 'suite/suite.css', 'grapher/grapher.css'])
body = '\n'.join([
    '<div class="app">',
    read('suite/nav.html'),
    '<div class="views">',
    read('suite/home.html'),
    '<section class="view" id="view-grapher" aria-label="Function Grapher" hidden>',
    read('grapher/markup.html'),
    '</section>',
    '<section class="view" id="view-fourier" aria-label="Fourier Circle Studio" hidden>',
    read('fourier/markup.html'),
    '</section>',
    '</div>',
    '</div>',
    read('suite/shared-markup.html'),
])
scripts = '\n'.join(f'<script>\n{read(p)}\n</script>' for p in ['suite/core.js', 'fourier/fourier.js', 'grapher/grapher.js', 'suite/router.js'])
page = f"{read('suite/head.html')}\n<style>\n{css}\n</style>\n{body}\n{scripts}\n"

os.makedirs(os.path.join(ROOT, 'build'), exist_ok=True)
open(os.path.join(ROOT, 'build', 'artifact.html'), 'w', encoding='utf-8').write(page)
full = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
        '</head>\n<body>\n' + page + '</body>\n</html>\n')
open(os.path.join(ROOT, 'index.html'), 'w', encoding='utf-8').write(full)
os.makedirs(os.path.join(ROOT, 'dist'), exist_ok=True)
shutil.copy(os.path.join(ROOT, 'index.html'), os.path.join(ROOT, 'dist', 'index.html'))
print('Built build/artifact.html, index.html and dist/index.html')
