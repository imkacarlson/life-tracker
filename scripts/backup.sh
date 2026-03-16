#!/usr/bin/env bash
#
# backup.sh — Dump the Life Tracker database and storage images to OneDrive.
#
# Usage:  npm run backup        (from the project root)
#         bash scripts/backup.sh
#
# Prerequisites:
#   - Supabase CLI linked to the project (run `npx supabase link` once)
#   - Running in WSL with access to powershell.exe (for zip creation)
#
# Change the path below if your OneDrive folder is somewhere else.
BACKUP_DIR="/mnt/c/Users/imkac/OneDrive/Life Tracker Backups"
MAX_BACKUPS=3

set -euo pipefail

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
npx supabase db dump --workdir "$PROJECT_ROOT" -f "$WORK_DIR/schema.sql"
echo "      schema.sql ($(wc -c < "$WORK_DIR/schema.sql" | tr -d ' ') bytes)"

# --- 2. Database data ---
echo "[2/3] Dumping database data..."
npx supabase db dump --data-only --workdir "$PROJECT_ROOT" -f "$WORK_DIR/data.sql"
echo "      data.sql ($(wc -c < "$WORK_DIR/data.sql" | tr -d ' ') bytes)"

# --- 3. Storage images ---
echo "[3/3] Downloading storage images..."
npx supabase storage cp -r --experimental --workdir "$PROJECT_ROOT" \
  "ss:///tracker-images" "$WORK_DIR/images" 2>&1 || true
IMAGE_COUNT="$(find "$WORK_DIR/images" -type f 2>/dev/null | wc -l | tr -d ' ')"
echo "      $IMAGE_COUNT image(s) downloaded"

# --- 4. Zip it up using PowerShell (always available in WSL) ---
echo ""
echo "Zipping backup..."
# Convert WSL temp path to Windows path for PowerShell
WIN_TEMP_DIR="$(wslpath -w "$TEMP_DIR")"
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
