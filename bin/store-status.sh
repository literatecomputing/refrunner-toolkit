#!/usr/bin/env bash
# What the Chrome Web Store has: the live version, and any version waiting for review.
# Runs the "Store status" workflow (GitHub signs in to Google as the publisher service
# account), waits for it, and prints its two summary lines. Needs only `gh` signed in.
set -euo pipefail
repo=literatecomputing/refrunner-toolkit
runs="repos/$repo/actions/workflows/store-status.yml/runs?per_page=1"
before=$(gh api "$runs" --jq '.workflow_runs[0].id // 0')
gh api -X POST "repos/$repo/actions/workflows/store-status.yml/dispatches" -f ref=main
echo "Asking the Chrome Web Store..."
for _ in $(seq 100); do
  read -r id status conclusion < <(gh api "$runs" --jq '.workflow_runs[0] | "\(.id) \(.status) \(.conclusion)"')
  [ "$id" != "$before" ] && [ "$status" = completed ] && break
  sleep 3
done
if [ "$status" != completed ] || [ "$conclusion" != success ]; then
  echo "The check didn't finish cleanly: https://github.com/$repo/actions/runs/$id"
  exit 1
fi
gh run view "$id" -R "$repo" --log | grep -oE '(Live|In review): .*' | head -2
