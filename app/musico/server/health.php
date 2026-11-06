<?php
declare(strict_types=1);

return static function (): void {
    [$musicoDb, $musicoError] = openMusicoDb();
    if ($musicoDb === false) {
        respond(503, ['status' => 'unavailable', 'error' => $musicoError]);
    }
    if (@pg_query($musicoDb,
        'SELECT u.id, u.auth_user_id, t.id, t.user_id, t.media_audio_id,
            t.version, t.stats_version,
            t.duration_ms, t.bit_rate, t.sample_rate_hz, t.bit_depth, t.channels, t.codec,
            t.estimated_bpm, t.estimated_key, t.peak_db, t.average_db,
            t.dynamic_range_db, t.analysis_saved_at,
            p.id, p.user_id, p.version, pt.playlist_id, pt.track_id, pt.position,
            upload.request_id, upload.request_sha256, upload.track_id,
            stat_request.request_id, stat_request.request_sha256, stat_request.track_id,
            stat_request.play_count, stat_request.listen_ms, stat_request.stats_version,
            changes.id, changes.cursor_token, changes.user_id, changes.resource, changes.resource_id, changes.action,
            playlist_create_request.user_id, playlist_create_request.request_id,
            playlist_create_request.request_name, playlist_create_request.playlist_id
         FROM public."user" u, public.track t, public.playlist p, public.playlist_track pt,
              public.track_upload_request upload, public.track_stat_request stat_request,
              public.change_log changes, public.playlist_create_request playlist_create_request LIMIT 0') === false) {
        respond(503, ['status' => 'unavailable', 'error' => 'Musico database schema is not ready']);
    }

};
