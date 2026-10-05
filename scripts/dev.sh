#!/usr/bin/env bash
# Starts the Firebase emulators and the server (fake auth, fixture provider) together.
set -euo pipefail
cd "$(dirname "$0")/.."
export FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
export STORAGE_EMULATOR_HOST=127.0.0.1:9199
export GCLOUD_PROJECT=demo-evalprop
bash scripts/with-java.sh pnpm exec firebase emulators:start --only firestore,storage --project demo-evalprop &
EMU=$!
trap 'kill $EMU 2>/dev/null || true' EXIT
node --watch apps/server/src/index.ts
