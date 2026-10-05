#!/usr/bin/env bash
# Runs a command with Java 21 on PATH (the Firebase emulators need it). Uses JAVA_HOME if set,
# otherwise Homebrew's openjdk@21.
set -euo pipefail
if [ -z "${JAVA_HOME:-}" ] && [ -d /opt/homebrew/opt/openjdk@21 ]; then
  export JAVA_HOME=/opt/homebrew/opt/openjdk@21
fi
if [ -n "${JAVA_HOME:-}" ]; then
  export PATH="$JAVA_HOME/bin:$PATH"
fi
exec "$@"
