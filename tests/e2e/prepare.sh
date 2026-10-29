#!/usr/bin/env bash
# Builds tests/e2e/site: a copy of the app with Firebase swapped for an in-memory fake.
# Needs: node/npm, python3, `pip install playwright && playwright install chromium`.
set -e
cd "$(dirname "$0")"
rm -rf site && mkdir site
cp -r ../../index.html ../../remote.html ../../manifest.webmanifest ../../css ../../js ../../icons site/
cp fake-firebase.js site/js/firebase.js
sed -n '/^\/\/ Every path the app reads/,$p' ../../js/firebase.js >> site/js/firebase.js
cp fake-server.js site/fake-server.js
[ -d node_modules/pdfjs-dist ] || npm install --no-save pdfjs-dist@3.11.174 >/dev/null
mkdir -p site/vendor shots
cp node_modules/pdfjs-dist/build/pdf.min.js node_modules/pdfjs-dist/build/pdf.worker.min.js site/vendor/
sed -i.bak "s#https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/#vendor/#g" site/js/computer.js && rm site/js/computer.js.bak
sed -i.bak '/fonts.googleapis\|fonts.gstatic/d' site/index.html site/remote.html && rm site/*.bak
echo "Ready. Now run: python3 run.py"
