#!/usr/bin/env bash
# Pick Python 3.10+ for the Google Cloud SDK (gcloud). Embedded 3.9 is deprecated.
# Idempotent: does nothing if CLOUDSDK_PYTHON is already set.
# Intended to be sourced from deploy scripts (do not execute directly).

if [[ -n "${CLOUDSDK_PYTHON:-}" ]]; then
  return 0
fi

_db_py=
for _db_py in python3.13 python3.12 python3.11 python3.10; do
  if command -v "$_db_py" &>/dev/null && "$_db_py" -c 'import sys; assert sys.version_info >= (3, 10)' 2>/dev/null; then
    export CLOUDSDK_PYTHON="$(command -v "$_db_py")"
    break
  fi
done

if [[ -z "${CLOUDSDK_PYTHON:-}" ]] && command -v python3 &>/dev/null && python3 -c 'import sys; assert sys.version_info >= (3, 10)' 2>/dev/null; then
  export CLOUDSDK_PYTHON="$(command -v python3)"
fi

unset _db_py

if [[ -z "${CLOUDSDK_PYTHON:-}" ]]; then
  printf '%s\n' "WARN: No Python 3.10+ on PATH; gcloud may use embedded Python 3.9 and warn. Install Python 3.12+ or set CLOUDSDK_PYTHON." >&2
fi
