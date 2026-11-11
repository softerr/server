<?php
declare(strict_types=1);

function checkCoreReadiness(): void
{
    if (appBaseUrl() === null) {
        respond(503, ['status' => 'unavailable', 'error' => 'Verification email is not configured']);
    }

    [$db, $error] = openDb();
    if ($db === false) {
        respond(503, ['status' => 'unavailable', 'error' => $error]);
    }

    $schema = @pg_query($db, 'SELECT u.id, u.email, u.role, u.deleting, u.approved_at, u.approved_by,
            u.account_kind, u.service_owner_id, u.display_name,
            t.hash, t.email_attempted_at, o.token_id, o.available_at, o.claimed_until, o.claim_id,
            a.applicant_id, a.recipient_id, a.available_at, a.claim_id,
            api.token_hash, api.app_access, activity.token_id, activity.status,
            mobile.access_hash, mobile.refresh_hash, mobile.previous_refresh_hash,
            mobile.previous_refresh_until, mobile.rotation_nonce, mobile.password_fingerprint,
            mobile.access_expires, mobile.refresh_expires, mobile.revoked_at
        FROM public."user" u, public.user_token t, public.verification_email_outbox o,
             public.approval_email_outbox a, public.api_token api, public.api_token_activity activity,
             public.mobile_session mobile
        LIMIT 0');
    if ($schema === false) {
        respond(503, ['status' => 'unavailable', 'error' => 'Database schema is not ready']);
    }
}

function checkMediaReadiness(): void
{
    if (!function_exists('imagecreatefromstring') || !function_exists('imagewebp')) {
        respond(503, ['status' => 'unavailable', 'error' => 'Image thumbnail support is not ready']);
    }
    [$mediaDb, $mediaError] = openMediaDb();
    if ($mediaDb === false) {
        respond(503, ['status' => 'unavailable', 'error' => $mediaError]);
    }
    $mediaSchema = @pg_query($mediaDb, 'SELECT i.id, i.blob_id, i.owner_auth_user_id, i.uploaded_by_auth_user_id, i.group_id,
            i.shared, i.original_name, b.sha256, b.mime_type, b.content,
            b.thumbnail_content, b.thumbnail_mime_type
        FROM public.image i, public.image_blob b LIMIT 0');
    if ($mediaSchema === false) {
        respond(503, ['status' => 'unavailable', 'error' => 'Media database schema is not ready']);
    }
    if (@pg_query($mediaDb, 'SELECT id, name FROM public.media_group LIMIT 0') === false) {
        respond(503, ['status' => 'unavailable', 'error' => 'Media database schema is not ready']);
    }
    if (@pg_query($mediaDb,
        'SELECT service_auth_user_id, app, resource_id, image_id
         FROM public.api_token_image_access LIMIT 0') === false) {
        respond(503, ['status' => 'unavailable', 'error' => 'Media token image grants are not ready']);
    }
    if (@pg_query($mediaDb, 'SELECT id, quiz_id, image_ids FROM public.quiz_import_recovery LIMIT 0') === false) {
        respond(503, ['status' => 'unavailable', 'error' => 'Media database schema is not ready']);
    }
    if (@pg_query($mediaDb, 'SELECT id, owner_auth_user_id, original_name, mime_type, size_bytes, sha256, content FROM public.audio_file LIMIT 0') === false) {
        respond(503, ['status' => 'unavailable', 'error' => 'Media audio schema is not ready']);
    }
}

function checkAppReadiness(string $app): void
{
    $check = require __DIR__ . "/../apps/{$app}/health.php";
    if (!is_callable($check)) {
        respond(503, ['status' => 'unavailable', 'error' => 'App readiness check is invalid']);
    }
    $check();
}

function handleReadiness(?string $component = null): never
{
    if ($component === 'core') {
        checkCoreReadiness();
        respond(200, ['status' => 'ok', 'message' => 'Core API is ready']);
    }
    if ($component === 'media') {
        checkMediaReadiness();
        respond(200, ['status' => 'ok', 'message' => 'Media API is ready']);
    }
    if ($component !== null) {
        if (!preg_match('/^[a-z][a-z0-9_]*$/D', $component)
            || !is_file(__DIR__ . "/../apps/{$component}/health.php")) {
            respond(404, ['error' => 'Not found']);
        }
        checkAppReadiness($component);
        respond(200, ['status' => 'ok', 'message' => "{$component} API is ready"]);
    }

    if (!class_exists(ZipArchive::class)) {
        respond(503, ['status' => 'unavailable', 'error' => 'ZIP support is not ready']);
    }
    checkCoreReadiness();
    $healthFiles = glob(__DIR__ . '/../apps/*/health.php');
    if ($healthFiles === false || count($healthFiles) === 0) {
        respond(503, ['status' => 'unavailable', 'error' => 'App readiness checks are missing']);
    }
    foreach ($healthFiles as $healthFile) {
        checkAppReadiness(basename(dirname($healthFile)));
    }
    checkMediaReadiness();
    respond(200, ['status' => 'ok', 'message' => 'API is ready']);
}
