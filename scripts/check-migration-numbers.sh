#!/usr/bin/env bash
set -euo pipefail

duplicates=$(
  for migration in supabase/migrations/*.sql; do
    filename=${migration##*/}
    printf '%s\n' "${filename%%_*}"
  done | sort | uniq -d
)

if [ -n "$duplicates" ]; then
  echo "::error::Migration numbers used more than once: $duplicates"
  exit 1
fi
