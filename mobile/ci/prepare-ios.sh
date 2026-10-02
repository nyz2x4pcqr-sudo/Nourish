#!/bin/bash
# Prepares the iOS project: copies the web app into the app and builds llama.cpp as
# Frameworks/llama.xcframework (for iPhones and the simulator), pinned to the same commit as Android.
set -eux
cd "$(dirname "$0")/../ios"
rm -rf webapp && mkdir -p webapp
for f in index.html styles.css app.js ondevice.js json-repair.js grocery.js units.js recipes.js manifest.webmanifest icon-192.png icon-512.png apple-touch-icon.png; do
  cp "../../$f" webapp/
done
LLAMA_COMMIT=$(grep -oE 'set\(LLAMA_COMMIT [0-9a-f]+' ../android/app/src/main/cpp/CMakeLists.txt | awk '{print $2}')
if [ ! -d Frameworks/llama.xcframework ]; then
  rm -rf llama-src && mkdir -p llama-src Frameworks
  curl -sSfL "https://github.com/ggml-org/llama.cpp/archive/${LLAMA_COMMIT}.tar.gz" | tar xz -C llama-src --strip-components 1
  (cd llama-src && ./build-xcframework.sh ios-device ios-sim)
  mv llama-src/build-apple/llama.xcframework Frameworks/
fi
ls Frameworks/llama.xcframework
