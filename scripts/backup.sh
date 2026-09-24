#!/usr/bin/env bash
#
# backup.sh — Dump the Life Tracker database and storage images to OneDrive.
#
# Usage:  npm run backup        (from the project root)
#         bash scripts/backup.sh
#
# Prerequisites:
#   - Supabase CLI linked to the project (run `npx supabase link` once)
#   - Running in WSL, or in Git Bash on Windows (Docker may live in WSL only)
#
# Override BACKUP_DIR in the environment if your OneDrive folder is somewhere else.
MAX_BACKUPS=3

set -euo pipefail

if grep -qi microsoft /proc/version 2>/dev/null; then
  PLATFORM=wsl
  : "${BACKUP_DIR:=/mnt/c/Users/imkac/OneDrive/Life Tracker Backups}"
else
  PLATFORM=windows
  : "${BACKUP_DIR:=$(cygpath -u "${OneDrive:-C:\\Users\\imkac\\OneDrive}")/Life Tracker Backups}"
fi

# Dump the linked database to $1; extra args are passed to `supabase db dump`.
# The CLI only prints its pg_dump script (--dry-run) and we run that in a
# postgres container, so it works even when the CLI itself can't see Docker
# (Windows npx from WSL, or Git Bash with Docker only inside WSL).
dump_db() {
  local out="$1"; shift
  local docker=(docker)
  [ "$PLATFORM" = windows ] && docker=(wsl.exe docker)
  npx supabase db dump --linked --workdir "$PROJECT_ROOT" --dry-run "$@" 2>/dev/null \
    | "${docker[@]}" run --rm -i postgres:17 bash > "$out"
}

to_win_path() {
  if [ "$PLATFORM" = wsl ]; then wslpath -w "$1"; else cygpath -w "$1"; fi
}

# --- Resolve project root (one level up from this script) ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

TIMESTAMP="$(date +%Y-%m-%d_%H%M%S)"
TEMP_DIR="$(mktemp -d)"
WORK_DIR="$TEMP_DIR/backup_$TIMESTAMP"
mkdir -p "$WORK_DIR/images"

cleanup() {
  rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

echo "=== Life Tracker Backup ==="
echo "Timestamp: $TIMESTAMP"
echo ""

# --- 1. Database schema ---
echo "[1/3] Dumping database schema..."
dump_db "$WORK_DIR/schema.sql"
echo "      schema.sql ($(wc -c < "$WORK_DIR/schema.sql" | tr -d ' ') bytes)"

# --- 2. Database data ---
echo "[2/3] Dumping database data..."
dump_db "$WORK_DIR/data.sql" --data-only
echo "      data.sql ($(wc -c < "$WORK_DIR/data.sql" | tr -d ' ') bytes)"

# --- 3. Storage images ---
echo "[3/3] Downloading storage images..."
IMAGES_DST="$WORK_DIR/images"
if [ "$PLATFORM" = windows ]; then
  # The CLI parses a "C:\..." destination as a URL with scheme "c", so pass a
  # drive-less path (resolves against the current drive) and skip MSYS mangling.
  IMAGES_DST="$(cygpath -m "$IMAGES_DST")"
  IMAGES_DST="${IMAGES_DST#?:}"
fi
MSYS_NO_PATHCONV=1 npx supabase storage cp -r --experimental --linked \
  "ss:///tracker-images" "$IMAGES_DST" >/dev/null 2>&1 || true
IMAGE_COUNT="$(find "$WORK_DIR/images" -type f 2>/dev/null | wc -l | tr -d ' ')"
echo "      $IMAGE_COUNT image(s) downloaded"
[ "$IMAGE_COUNT" -gt 0 ] || echo "      WARNING: no images downloaded — check 'supabase storage cp' manually"

# --- 4. Zip it up using PowerShell (available from both WSL and Git Bash) ---
echo ""
echo "Zipping backup..."
# Convert temp path to a Windows path for PowerShell
WIN_TEMP_DIR="$(to_win_path "$TEMP_DIR")"
WIN_SRC="$WIN_TEMP_DIR\\backup_$TIMESTAMP"
WIN_ZIP="$WIN_TEMP_DIR\\backup_$TIMESTAMP.zip"
powershell.exe -NoProfile -Command \
  "Compress-Archive -Path '$WIN_SRC' -DestinationPath '$WIN_ZIP'" 2>&1
ZIP_FILE="$TEMP_DIR/backup_$TIMESTAMP.zip"
ZIP_SIZE="$(wc -c < "$ZIP_FILE" | tr -d ' ')"
echo "      backup_$TIMESTAMP.zip ($ZIP_SIZE bytes)"

# --- 5. Rotate old backups ---
mkdir -p "$BACKUP_DIR"
EXISTING=()
while IFS= read -r f; do
  [ -n "$f" ] && EXISTING+=("$f")
done < <(ls -1t "$BACKUP_DIR"/backup_*.zip 2>/dev/null || true)
EXISTING_COUNT=${#EXISTING[@]}

if [ "$EXISTING_COUNT" -ge "$MAX_BACKUPS" ]; then
  # Delete the oldest backups to make room for the new one
  DELETE_FROM=$(( MAX_BACKUPS - 1 ))
  echo ""
  echo "Rotating backups (keeping newest $MAX_BACKUPS)..."
  for (( i=DELETE_FROM; i<EXISTING_COUNT; i++ )); do
    echo "  Removing: $(basename "${EXISTING[$i]}")"
    rm -f "${EXISTING[$i]}"
  done
fi

# --- 6. Deliver ---
cp "$ZIP_FILE" "$BACKUP_DIR/"
echo ""
echo "=== Backup complete ==="
echo "Saved to: $BACKUP_DIR/backup_$TIMESTAMP.zip"

# Show what's there now
echo ""
echo "Current backups:"
ls -1t "$BACKUP_DIR"/backup_*.zip 2>/dev/null | while read -r f; do
  SIZE="$(wc -c < "$f" | tr -d ' ')"
  echo "  $(basename "$f")  ($SIZE bytes)"
done
