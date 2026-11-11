#!/usr/bin/env bash

cleanup_app_test_media() {
  local ids="$1"
  test_psql media "DELETE FROM public.quiz_import_recovery WHERE owner_auth_user_id IN (${ids});" >/dev/null
}
