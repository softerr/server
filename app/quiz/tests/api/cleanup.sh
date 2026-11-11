#!/usr/bin/env bash

cleanup_app_test_users() {
  local ids="$1"
  test_psql quiz "DELETE FROM public.quiz_import_receipt WHERE owner_auth_user_id IN (${ids});
    DELETE FROM public.\"user\" WHERE auth_user_id IN (${ids});" >/dev/null
}
