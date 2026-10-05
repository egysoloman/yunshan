#!/usr/bin/env bash
set -euo pipefail
if [[ "$#" != 1 || "$1" != "--authorized-m2-causal-before" ]]; then
  printf '%s\n' 'CODEPREP ONLY: requires a later explicit root CPU GO and exact authorization flag.' >&2
  exit 64
fi
exec python3 /tmp/yunshan-clinical-arrival-prep-final03-20261003-01/execution-prep/run-m2-before.py "$1"
