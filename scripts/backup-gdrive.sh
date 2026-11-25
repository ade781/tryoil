#!/usr/bin/env bash
set -euo pipefail

# Direktori aplikasi (parent dari folder scripts/)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Muat variabel lingkungan dari .env jika tersedia
if [[ -f "${APP_DIR}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${APP_DIR}/.env"
  set +a
fi

DB_NAME="${DB_NAME:-toko_pancing}"
DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-3306}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/mysql}"
RCLONE_REMOTE="${RCLONE_REMOTE:-gdrive:backup-mysql-toko-pancing}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"

TIMESTAMP="$(date +"%Y%m%d_%H%M%S")"
BACKUP_FILE="${BACKUP_DIR}/${DB_NAME}_${TIMESTAMP}.sql.gz"

umask 077
mkdir -p "${BACKUP_DIR}"

echo "[$(date -Is)] Memulai backup database '${DB_NAME}'..."

DUMP_ARGS=(
  --single-transaction
  --quick
  --routines
  --triggers
)

if [[ -n "${DB_USER:-}" ]]; then
  DUMP_ARGS+=(--host="${DB_HOST}" --port="${DB_PORT}" --user="${DB_USER}")
  export MYSQL_PWD="${DB_PASSWORD:-}"
fi

# Gunakan ~/.my.cnf secara otomatis jika DB_USER tidak disetel di .env
mysqldump "${DUMP_ARGS[@]}" "${DB_NAME}" | gzip -c > "${BACKUP_FILE}"
unset MYSQL_PWD || true

if [[ ! -s "${BACKUP_FILE}" ]]; then
  echo "[$(date -Is)] ERROR: File backup kosong atau gagal dibuat: ${BACKUP_FILE}" >&2
  rm -f "${BACKUP_FILE}"
  exit 1
fi

echo "[$(date -Is)] Backup lokal tersimpan: ${BACKUP_FILE}"

echo "[$(date -Is)] Mengunggah ke ${RCLONE_REMOTE}..."
rclone copy "${BACKUP_FILE}" "${RCLONE_REMOTE}"

echo "[$(date -Is)] Menghapus backup lokal lebih dari ${RETENTION_DAYS} hari..."
find "${BACKUP_DIR}" -maxdepth 1 -type f -name "${DB_NAME}_*.sql.gz" -mtime +"${RETENTION_DAYS}" -delete

echo "[$(date -Is)] Backup selesai dengan sukses."
