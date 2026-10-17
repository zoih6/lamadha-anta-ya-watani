#!/usr/bin/env bash
# push.sh — publish the project into the GitHub repository.
# Usage:  bash scripts/push.sh "commit message"
set -euo pipefail

MSG="${1:-update: motion-graphics build}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO="${REPO:-/home/user/repo}"
TOKEN_FILE="${TOKEN_FILE:-/home/user/.secrets/gh_token}"
DEST="$REPO/motion"

[ -f "$TOKEN_FILE" ] || { echo "!! no token at $TOKEN_FILE"; exit 1; }
TOKEN="$(cat "$TOKEN_FILE")"

echo ">> syncing $ROOT  ->  $DEST"
mkdir -p "$DEST"

rsync -a --delete \
  --exclude 'node_modules/' \
  --exclude 'frames/' \
  --exclude 'analysis/qa/*.jpg' \
  --exclude 'analysis/_*.log' \
  --exclude 'analysis/spectrogram.png' \
  --exclude 'output/' \
  --exclude '.git/' \
  "$ROOT/" "$DEST/"

# the render is the deliverable — copy it separately so --delete never eats it
mkdir -p "$DEST/output"
for f in "$ROOT"/output/*.mp4; do
  [ -e "$f" ] && cp -v "$f" "$DEST/output/"
done

cd "$REPO"
git config user.name  "vox-engine"
git config user.email "vox-engine@local"

# keep the audio master at the repo root, always
git add -A
if git diff --cached --quiet; then
  echo ">> nothing to commit"
else
  git commit -q -m "$MSG"
  git push -q "https://oauth2:${TOKEN}@github.com/zoih6/lamadha-anta-ya-watani.git" HEAD:master
  echo ">> pushed: $MSG"
fi
echo ">> done"
