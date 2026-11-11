<?php
declare(strict_types=1);

function musicoUploadRequestId(): ?string
{
    $value = $_SERVER['HTTP_IDEMPOTENCY_KEY'] ?? null;
    if ($value === null) return null;
    if (!is_string($value) || preg_match(
        '/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/D',
        $value) !== 1) respond(400, ['error' => 'Invalid Idempotency-Key']);
    return strtolower($value);
}

function requiredMusicoStatisticRequestId(): string
{
    $requestId = musicoUploadRequestId();
    if ($requestId === null) respond(428, ['error' => 'Idempotency-Key is required']);
    return $requestId;
}

function musicoStatisticResult(array $row): array
{
    return ['play_count' => (int) $row['play_count'], 'listen_ms' => (int) $row['listen_ms'],
        'stats_version' => (int) $row['stats_version']];
}

function replayMusicoStatisticRequest($db, int $userId, string $requestId,
    string $requestHash): ?array
{
    $result = @pg_query_params($db,
        'SELECT request_sha256, play_count, listen_ms, stats_version
         FROM public.track_stat_request WHERE user_id = $1 AND request_id = $2',
        [$userId, $requestId]);
    if ($result === false) respond(500, ['error' => 'Could not check statistic request']);
    $row = pg_fetch_assoc($result);
    if ($row === false) return null;
    if (!hash_equals(trim($row['request_sha256']), $requestHash)) {
        respond(409, ['error' => 'Idempotency-Key was used for a different statistic request']);
    }
    return musicoStatisticResult($row);
}

function recordMusicoStatisticRequest($db, int $userId, string $requestId,
    string $requestHash, int $trackId, array $row): void
{
    $saved = @pg_query_params($db,
        'INSERT INTO public.track_stat_request
             (user_id, request_id, request_sha256, track_id, play_count, listen_ms, stats_version)
         VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [$userId, $requestId, $requestHash, $trackId, $row['play_count'], $row['listen_ms'],
            $row['stats_version']]);
    if ($saved === false) respond(500, ['error' => 'Could not record statistic request']);
}

function recordMusicoUploadRequest($db, int $userId, ?string $requestId,
    string $requestHash, int $trackId): void
{
    if ($requestId === null) return;
    $saved = @pg_query_params($db,
        'INSERT INTO public.track_upload_request (user_id, request_id, request_sha256, track_id)
         VALUES ($1, $2, $3, $4)', [$userId, $requestId, $requestHash, $trackId]);
    if ($saved === false) respond(500, ['error' => 'Could not record upload request']);
}

