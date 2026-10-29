#!/usr/bin/env bash

test_quiz_import_recovers_failed_commit() (
  if [[ ! "${API_TEST_BASE_URL}" =~ ^http://(127\.0\.0\.1|localhost)(:[0-9]+)?/?$ ]]; then
    skip_test 'cross-database recovery test requires the local API and systemd worker'
    return 200
  fi
  create_test_identity
  local password='import_recovery_test_password'
  local password_hash user_id cookie_file image_file image_data body response quiz_name
  password_hash="$(php -r 'echo password_hash($argv[1], PASSWORD_DEFAULT);' "$password")"
  user_id="$(test_psql auth "INSERT INTO public.\"user\" (username, password, email, verified, approved_at)
    VALUES ('${TEST_USERNAME}', '${password_hash}', '${TEST_EMAIL}', TRUE, CURRENT_TIMESTAMP)
    RETURNING id;")" || return 1
  [[ "$user_id" =~ ^[1-9][0-9]*$ ]] || return 1
  cookie_file="$(mktemp)"
  image_file="$(mktemp)"
  trap 'test_psql quiz "DROP TRIGGER IF EXISTS test_import_commit_failure ON public.quiz;
    DROP FUNCTION IF EXISTS public.test_import_commit_failure();" >/dev/null; rm -f "$cookie_file" "$image_file"' EXIT

  sudo -n systemctl restart nginx || return 1

  body="$(jq -nc --arg email "$TEST_EMAIL" --arg password "$password" '{email:$email,password:$password}')"
  response="$(curl -sS -c "$cookie_file" -H 'Content-Type: application/json' \
    --data "$body" -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/auth/login")"
  [[ "${response##*$'\n'}" == 200 ]] || { fail_test "recovery fixture login failed: $response"; return 1; }

  quiz_name="api_test_import_recovery_${API_TEST_RUN_ID}"
  test_psql quiz "DROP TRIGGER IF EXISTS test_import_commit_failure ON public.quiz;
    DROP FUNCTION IF EXISTS public.test_import_commit_failure();
    CREATE FUNCTION public.test_import_commit_failure() RETURNS trigger
    LANGUAGE plpgsql AS \$\$ BEGIN
      IF NEW.name = '${quiz_name}' THEN
        RAISE EXCEPTION 'forced quiz commit failure';
      END IF;
      RETURN NULL;
    END \$\$;
    CREATE CONSTRAINT TRIGGER test_import_commit_failure
      AFTER INSERT ON public.quiz DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION public.test_import_commit_failure();" >/dev/null || return 1

  printf '%s' 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=' \
    | base64 -d > "$image_file"
  printf '%s' "$TEST_USERNAME" >> "$image_file"
  image_data="$(base64 -w0 "$image_file")"
  body="$(jq -nc --arg name "$quiz_name" --arg image "$image_data" --arg filename "${TEST_USERNAME}.png" \
    '{format:"softerr-quiz",version:1,name:$name,description:"",questions:[{template:"no_answer",prompt:"Image",config:{image_id:1}}],images:[{id:1,name:$filename,data:$image}]}')"
  response="$(curl -sS -b "$cookie_file" -H 'Content-Type: application/json' \
    --data "$body" -w $'\n%{http_code}' "${API_TEST_BASE_URL%/}/api/quiz/quizzes/import")"
  [[ "${response##*$'\n'}" == 500 ]] || { fail_test "forced quiz commit failure returned: $response"; return 1; }

  local quiz_count image_count pending_count
  quiz_count="$(test_psql quiz "SELECT count(*) FROM public.quiz WHERE name = '${quiz_name}';")" || return 1
  [[ "$(test_psql quiz "SELECT count(*) FROM public.quiz_import_receipt WHERE owner_auth_user_id = ${user_id};")" == 0 ]] \
    || { fail_test 'failed import left a commit receipt'; return 1; }
  image_count="$(test_psql media "SELECT count(*) FROM public.image WHERE owner_auth_user_id = ${user_id}
    AND original_name = '${TEST_USERNAME}.png';")" || return 1
  pending_count="$(test_psql media "SELECT count(*) FROM public.quiz_import_recovery
    WHERE owner_auth_user_id = ${user_id};")" || return 1
  [[ "$quiz_count" == 0 && "$image_count" == 0 && "$pending_count" == 0 ]] \
    || { fail_test "failed import left quiz=$quiz_count, images=$image_count, recovery=$pending_count"; return 1; }

  # Simulate a request stopping after its media commit. The timer must be able
  # to finish cleanup without the original PHP request or quiz transaction.
  local image_id batch_id
  response="$(curl -sS -b "$cookie_file" --data-binary @"$image_file" \
    -H "X-Image-Name: ${TEST_USERNAME}.png" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/media/images")"
  [[ "${response##*$'\n'}" == 201 ]] || { fail_test "recovery fixture image upload failed: $response"; return 1; }
  image_id="$(jq -r '.id // empty' <<<"${response%$'\n'*}")"
  [[ "$image_id" =~ ^[1-9][0-9]*$ ]] || return 1
  batch_id="$(php -r 'echo bin2hex(random_bytes(16));')"
  test_psql media "INSERT INTO public.quiz_import_recovery
    (id, owner_auth_user_id, quiz_id, image_ids, created)
    VALUES ('${batch_id}', ${user_id}, 0, '[${image_id}]'::jsonb,
      CURRENT_TIMESTAMP - INTERVAL '10 minutes');" >/dev/null || return 1
  sudo -n systemctl start softerr-recover-quiz-imports.service \
    || { fail_test 'quiz import recovery worker failed'; return 1; }
  image_count="$(test_psql media "SELECT count(*) FROM public.image WHERE id = ${image_id};")" || return 1
  pending_count="$(test_psql media "SELECT count(*) FROM public.quiz_import_recovery WHERE id = '${batch_id}';")" || return 1
  [[ "$image_count" == 0 && "$pending_count" == 0 ]] \
    || { fail_test "recovery worker left images=$image_count, pending=$pending_count"; return 1; }

  # A committed receipt remains valid after its quiz is deleted. The worker
  # must keep this image while clearing the stale cross-database records.
  response="$(curl -sS -b "$cookie_file" --data-binary @"$image_file" \
    -H "X-Image-Name: ${TEST_USERNAME}.png" -w $'\n%{http_code}' \
    "${API_TEST_BASE_URL%/}/api/media/images")"
  [[ "${response##*$'\n'}" == 201 ]] || { fail_test "committed fixture image upload failed: $response"; return 1; }
  image_id="$(jq -r '.id // empty' <<<"${response%$'\n'*}")"
  [[ "$image_id" =~ ^[1-9][0-9]*$ ]] || return 1
  batch_id="$(php -r 'echo bin2hex(random_bytes(16));')"
  test_psql quiz "INSERT INTO public.quiz_import_receipt (id, owner_auth_user_id, quiz_id, created)
    VALUES ('${batch_id}', ${user_id}, 0, CURRENT_TIMESTAMP - INTERVAL '10 minutes');" >/dev/null || return 1
  test_psql media "INSERT INTO public.quiz_import_recovery
    (id, owner_auth_user_id, quiz_id, image_ids, created)
    VALUES ('${batch_id}', ${user_id}, 0, '[${image_id}]'::jsonb,
      CURRENT_TIMESTAMP - INTERVAL '10 minutes');" >/dev/null || return 1
  sudo -n systemctl start softerr-recover-quiz-imports.service \
    || { fail_test 'quiz import committed receipt recovery failed'; return 1; }
  image_count="$(test_psql media "SELECT count(*) FROM public.image WHERE id = ${image_id};")" || return 1
  pending_count="$(test_psql media "SELECT count(*) FROM public.quiz_import_recovery WHERE id = '${batch_id}';")" || return 1
  [[ "$image_count" == 1 && "$pending_count" == 0 ]] \
    || { fail_test "committed recovery kept images=$image_count, pending=$pending_count"; return 1; }
  [[ "$(test_psql quiz "SELECT count(*) FROM public.quiz_import_receipt WHERE id = '${batch_id}';")" == 0 ]] \
    || { fail_test 'committed recovery left a receipt'; return 1; }
)

register_test_case test_quiz_import_recovers_failed_commit
