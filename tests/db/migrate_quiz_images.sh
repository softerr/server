#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
psql_as_postgres() {
  local db="$1" sql="$2"
  sudo -n -u postgres psql -X -v ON_ERROR_STOP=1 -Atq -d "$db" -c "$sql"
}

had_legacy="$(psql_as_postgres quiz "SELECT to_regclass('public.image') IS NOT NULL")"
if [[ "$had_legacy" != t ]]; then
  psql_as_postgres quiz 'CREATE TABLE public.image (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
    sha256 CHAR(64) NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    mime_type VARCHAR(16) NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    content BYTEA NOT NULL
  )' >/dev/null
fi

legacy_id=''
owner_id=''
image_hash=''
cleanup() {
  local result=$?
  trap - EXIT
  if [[ -n "$legacy_id" ]]; then
    psql_as_postgres media "DELETE FROM public.image WHERE id = $legacy_id" >/dev/null || result=1
    psql_as_postgres media "DELETE FROM public.legacy_quiz_image_import WHERE legacy_id = $legacy_id" >/dev/null || result=1
  fi
  if [[ -n "$image_hash" ]]; then
    psql_as_postgres media "DELETE FROM public.image_blob b WHERE sha256 = '$image_hash'
      AND NOT EXISTS (SELECT 1 FROM public.image i WHERE i.blob_id = b.id)" >/dev/null || result=1
  fi
  if [[ -n "$owner_id" ]]; then
    psql_as_postgres quiz "DELETE FROM public.\"user\" WHERE id = $owner_id" >/dev/null || result=1
  fi
  if [[ "$had_legacy" != t ]]; then
    psql_as_postgres quiz 'DROP TABLE public.image' >/dev/null || result=1
  fi
  exit "$result"
}
trap cleanup EXIT

owner_id="$(psql_as_postgres quiz "INSERT INTO public.\"user\" (auth_user_id)
  VALUES (-$$) RETURNING id")"
quiz_max="$(psql_as_postgres quiz 'SELECT COALESCE(MAX(id), 0) FROM public.image')"
media_low_max="$(psql_as_postgres media 'SELECT COALESCE(MAX(id), 0) FROM public.image WHERE id < 1000000000000')"
legacy_id="$(( (quiz_max > media_low_max ? quiz_max : media_low_max) + 1 ))"
image_hash="$(printf '%s' "$legacy_id" | sha256sum | cut -d ' ' -f 1)"
psql_as_postgres quiz "INSERT INTO public.image
  (id, user_id, sha256, original_name, mime_type, width, height, content)
  VALUES ($legacy_id, $owner_id, '$image_hash', 'migration-test.png',
    'image/png', 1, 1, decode('010203', 'hex'))" >/dev/null

sudo -n -u postgres psql -X -v ON_ERROR_STOP=1 -1 -d media \
  < "$ROOT/configs/postgresql/migrate_quiz_images.sql" >/dev/null

copied="$(psql_as_postgres media "SELECT COUNT(*) FROM public.image i
  JOIN public.image_blob b ON b.id = i.blob_id
  WHERE i.id = $legacy_id AND i.owner_auth_user_id = -$$
    AND i.shared = FALSE AND b.sha256 = '$image_hash'
    AND b.content = decode('010203', 'hex')")"
if [[ "$copied" != 1 ]]; then
  echo 'Legacy quiz image was not copied with its original ID and bytes.' >&2
  exit 1
fi
psql_as_postgres media "DELETE FROM public.image WHERE id = $legacy_id" >/dev/null
sudo -n -u postgres psql -X -v ON_ERROR_STOP=1 -1 -d media \
  < "$ROOT/configs/postgresql/migrate_quiz_images.sql" >/dev/null
resurrected="$(psql_as_postgres media "SELECT COUNT(*) FROM public.image WHERE id = $legacy_id")"
if [[ "$resurrected" != 0 ]]; then
  echo 'Deleted migrated image was resurrected on setup rerun.' >&2
  exit 1
fi
echo 'Legacy migration preserved image data and did not resurrect a deleted image.'
