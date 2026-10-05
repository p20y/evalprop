#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
bash scripts/with-java.sh pnpm exec firebase emulators:exec --only firestore,storage --project demo-evalprop \
  "node --test tests/rules/*.emulator.test.ts $(find packages apps -name '*.emulator.test.ts' -not -path '*/node_modules/*' | tr '\n' ' ')"
