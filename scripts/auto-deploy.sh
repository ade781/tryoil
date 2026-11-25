#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/tryoil}"
BRANCH="${BRANCH:-main}"
PM2_NAME="${PM2_NAME:-tryoil}"
LOCK_FILE="/tmp/tryoil-autodeploy.lock"

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  exit 0
fi

cd "$APP_DIR"

git fetch origin "$BRANCH" --quiet
LOCAL_REV="$(git rev-parse HEAD)"
REMOTE_REV="$(git rev-parse "origin/$BRANCH")"

if [ "$LOCAL_REV" = "$REMOTE_REV" ]; then
  exit 0
fi

echo "[$(date -Iseconds)] Update terdeteksi ($LOCAL_REV -> $REMOTE_REV). Memulai deploy..."

DEPS_CHANGED=0
if git diff --name-only "$LOCAL_REV" "$REMOTE_REV" | grep -qE '^package(-lock)?\.json$'; then
  DEPS_CHANGED=1
fi

git pull --ff-only origin "$BRANCH"

if [ "$DEPS_CHANGED" -eq 1 ]; then
  echo "[$(date -Iseconds)] package.json berubah, menjalankan npm install --omit=dev..."
  npm install --omit=dev
fi

if pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
  pm2 restart "$PM2_NAME"
else
  pm2 start "$APP_DIR/server.js" --name "$PM2_NAME"
fi

echo "[$(date -Iseconds)] Deploy selesai."
