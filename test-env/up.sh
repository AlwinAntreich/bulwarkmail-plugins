#!/usr/bin/env bash
# Start the plugin test environment, wait for health and seed it.
#
#   ./up.sh              Stalwart, Nextcloud, Paperless, Papra, Vikunja, mocks
#   ./up.sh --with-ai    the same plus Ollama with a small model
#
# Safe to run again: containers are reused and the seeds are idempotent.
set -euo pipefail
cd "$(dirname "$0")"

WITH_AI=0
for arg in "$@"; do
  case "$arg" in
    --with-ai) WITH_AI=1 ;;
    -h|--help) sed -n '2,7p' "$0"; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

if [ -z "${PYTHON:-}" ]; then
  # On Windows, python3 can be the Microsoft Store stub, so check it runs.
  for candidate in python3 python; do
    if "$candidate" -c 'import sys; sys.exit(sys.version_info < (3, 8))' >/dev/null 2>&1; then
      PYTHON=$candidate
      break
    fi
  done
fi
[ -n "${PYTHON:-}" ] || { echo "Python 3 is needed for the seed scripts" >&2; exit 1; }

if [ ! -f stalwart/stalwart-cli ]; then
  echo "Fetching stalwart-cli for the Stalwart image"
  # The script ends by running the Linux binary, which fails on a non-Linux
  # host; the file is all the build needs.
  bash stalwart/prepare-stalwart-cli.sh || true
  [ -f stalwart/stalwart-cli ] || { echo "stalwart/stalwart-cli is missing" >&2; exit 1; }
fi

PROFILE=()
SEED_ARGS=()
if [ "$WITH_AI" = 1 ]; then
  PROFILE=(--profile ai)
  SEED_ARGS=(--with-ai)
fi

docker compose ${PROFILE[@]+"${PROFILE[@]}"} up -d --build --wait --wait-timeout 600
"$PYTHON" seed/seed_all.py ${SEED_ARGS[@]+"${SEED_ARGS[@]}"}
