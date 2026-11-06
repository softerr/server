#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo 'Run as root.' >&2
  exit 1
fi
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
upgrade_needed="$(sudo -u postgres psql -X -At -v ON_ERROR_STOP=1 -d musico -c \
  "SELECT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.track'::regclass
    AND attname IN ('content', 'original_name', 'mime_type', 'size_bytes', 'content_sha256')
    AND NOT attisdropped)
    OR EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.track'::regclass
    AND attname = 'media_audio_id' AND NOT attnotnull AND NOT attisdropped)")"
if [[ "${upgrade_needed}" == f ]]; then
  exit 0
fi
if [[ -z "${API_DB_PASSWORD:-}" ]]; then
  if [[ ! -r /etc/softerr/bootstrap-db-password ]]; then
    echo 'Database password is unavailable for audio upgrade.' >&2
    exit 1
  fi
  API_DB_PASSWORD="$(cat /etc/softerr/bootstrap-db-password)"
fi
DB_PASSWORD="${API_DB_PASSWORD}" php "${SCRIPT_DIR}/migrate_musico_audio.php"

# Hold an exclusive lock for the final check so no old API request can insert
# another unlinked track between validation and removing the legacy columns.
sudo -u postgres psql -X -v ON_ERROR_STOP=1 -d musico <<'SQL'
BEGIN;
LOCK TABLE public.track IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.track WHERE media_audio_id IS NULL) THEN
    RAISE EXCEPTION 'Unlinked Musico tracks remain; retry the audio upgrade';
  END IF;
END $$;
ALTER TABLE public.track ALTER COLUMN media_audio_id SET NOT NULL;
ALTER TABLE public.track DROP COLUMN IF EXISTS content;
ALTER TABLE public.track DROP COLUMN IF EXISTS original_name;
ALTER TABLE public.track DROP COLUMN IF EXISTS mime_type;
ALTER TABLE public.track DROP COLUMN IF EXISTS size_bytes;
ALTER TABLE public.track DROP COLUMN IF EXISTS content_sha256;
DROP INDEX IF EXISTS public.track_media_audio_id_idx;
COMMIT;
SQL
