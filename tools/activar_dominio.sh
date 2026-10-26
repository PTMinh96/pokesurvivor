#!/usr/bin/env bash
# Final step for the pokesurvivor.com domain (see docs/DOMINIO.md).
#   DRY=1 bash tools/activar_dominio.sh   test: prepare everything, show what would be pushed, then restore the original state
#   bash tools/activar_dominio.sh         prepare and commit (push and GitHub Pages are separate)
set -euo pipefail
cd "$(dirname "$0")/.."
DOMAIN=pokesurvivor.com

# 1. Build the game with SEO markup, data, and pages in both languages.
node tools/build.js
node tools/export_data.js
python tools/make_seo_pages.py

# 2. Custom domain for GitHub Pages.
echo "$DOMAIN" > CNAME

FILES=(CNAME .gitignore index.html js/app.min.js 404.html robots.txt sitemap.xml assets/og-image.jpg
       apoyar en guia legendarios logros movimientos novedades objetos pokedex shinies tipos
       docs/SEO.md docs/DOMINIO.md tools/export_data.js tools/make_seo_pages.py tools/activar_dominio.sh)
git add "${FILES[@]}"
echo "--- se subiría:"
git diff --cached --stat | tail -5
git diff --cached --name-only | grep -c . | xargs echo "archivos:"

deshacer() { git reset -q; rm -f CNAME; node tools/build.js --sin-seo; }

# Never include private data (the script itself is excluded: it contains the search terms).
if git diff --cached -- . ':(exclude)tools/activar_dominio.sh' | grep -qiE "jonathanclase78|assesingamerxd|CONTACTOS_CREADORES"; then
  echo "ERROR: hay datos privados en lo que se va a subir"; deshacer; exit 1
fi

if [ "${DRY:-0}" = "1" ]; then
  deshacer
  echo "--- ensayo terminado: todo como estaba"
  exit 0
fi

git commit -q -m "Dominio propio $DOMAIN: páginas en español e inglés, sitemap y CNAME"
echo "--- commit hecho. Falta: git push y, en GitHub Pages, el dominio y HTTPS."
