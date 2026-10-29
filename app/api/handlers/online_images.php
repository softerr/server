<?php
declare(strict_types=1);

const COMMONS_API_URL = 'https://commons.wikimedia.org/w/api.php';

function commonsFetch(string $url, int $maxBytes): array
{
    $origin = appBaseUrl();
    if ($origin === null) respond(503, ['error' => 'Online image search is unavailable']);
    $context = stream_context_create([
        'http' => [
            'method' => 'GET',
            'user_agent' => "Softerr/1.0 ({$origin})",
            'timeout' => 12,
            'follow_location' => 0,
        ],
        'ssl' => ['verify_peer' => true, 'verify_peer_name' => true],
    ]);
    $stream = @fopen($url, 'rb', false, $context);
    if ($stream === false) return [false, '', false];
    $headers = stream_get_meta_data($stream)['wrapper_data'] ?? [];
    if (!preg_match('~^HTTP/\S+ 200(?: |$)~', $headers[0] ?? '')) {
        fclose($stream);
        return [false, '', false];
    }
    $body = '';
    while (!feof($stream)) {
        $chunk = fread($stream, min(65536, $maxBytes + 1 - strlen($body)));
        if ($chunk === false || ($chunk === '' && !feof($stream))) {
            fclose($stream);
            return [false, '', false];
        }
        $body .= $chunk;
        if (strlen($body) > $maxBytes) {
            fclose($stream);
            return [false, '', true];
        }
    }
    $timedOut = stream_get_meta_data($stream)['timed_out'];
    fclose($stream);
    return [!$timedOut, $body, false];
}

function commonsApi(array $params): array
{
    $url = COMMONS_API_URL . '?' . http_build_query([
        'action' => 'query', 'format' => 'json', 'formatversion' => '2', ...$params,
    ], '', '&', PHP_QUERY_RFC3986);
    [$ok, $body] = commonsFetch($url, 1048576);
    if (!$ok) respond(503, ['error' => 'Could not reach Wikimedia Commons']);
    $data = json_decode($body, true);
    if (!is_array($data) || isset($data['error'])) {
        respond(503, ['error' => 'Wikimedia Commons returned an invalid response']);
    }
    return $data;
}

function commonsHttpsUrl(mixed $value, string|array $hosts): ?string
{
    if (!is_string($value) || filter_var($value, FILTER_VALIDATE_URL) === false) return null;
    $parts = parse_url($value);
    if ($parts === false || strtolower($parts['scheme'] ?? '') !== 'https'
        || !in_array(strtolower($parts['host'] ?? ''), (array) $hosts, true)
        || isset($parts['user']) || isset($parts['pass'])
        || (isset($parts['port']) && $parts['port'] !== 443)) return null;
    return $value;
}

function commonsText(mixed $value, int $limit = 1000): string
{
    if (!is_string($value)) return '';
    $plain = trim(html_entity_decode(strip_tags($value), ENT_QUOTES | ENT_HTML5, 'UTF-8'));
    preg_match('/^.{0,' . $limit . '}/us', $plain, $match);
    return $match[0] ?? '';
}

function handleSearchOnlineImages(): never
{
    currentSessionUser();
    $query = $_GET['q'] ?? null;
    if (!is_string($query) || strlen(trim($query)) < 2 || strlen($query) > 100
        || preg_match('//u', $query) !== 1) {
        respond(400, ['error' => 'Search must be 2 to 100 UTF-8 bytes']);
    }
    $data = commonsApi([
        'generator' => 'search', 'gsrsearch' => trim($query),
        'gsrnamespace' => '6', 'gsrlimit' => '20',
        'prop' => 'imageinfo', 'iiprop' => 'url|mime|size|dimensions', 'iiurlwidth' => '240',
    ]);
    $results = [];
    foreach ($data['query']['pages'] ?? [] as $page) {
        $info = $page['imageinfo'][0] ?? null;
        if (!is_array($info) || !is_int($page['pageid'] ?? null)
            || !in_array($info['mime'] ?? null, ['image/png', 'image/jpeg', 'image/webp'], true)
            || ($info['size'] ?? 0) < 1 || ($info['size'] ?? 0) > MEDIA_IMAGE_MAX_BYTES
            || ($info['width'] ?? 0) < 1 || ($info['width'] ?? 0) > 4096
            || ($info['height'] ?? 0) < 1 || ($info['height'] ?? 0) > 4096) continue;
        $thumbnail = commonsHttpsUrl($info['thumburl'] ?? null,
            ['upload.wikimedia.org', 'thumb.wikimedia.org']);
        $sourcePage = commonsHttpsUrl($info['descriptionurl'] ?? null, 'commons.wikimedia.org');
        $name = preg_replace('/^File:/', '', $page['title'] ?? '');
        if ($thumbnail === null || $sourcePage === null || !is_string($name)
            || $name === '' || strlen($name) > 255
            || preg_match('~[\x00-\x1F\x7F/\\\\]~u', $name) === 1) continue;
        $results[] = [
            'id' => $page['pageid'],
            'name' => $name,
            'thumbnail_url' => $thumbnail,
            'source_page' => $sourcePage,
        ];
    }
    respond(200, ['results' => $results]);
}

function handleImportOnlineImage(): never
{
    $user = currentSessionUser();
    $payload = readJsonBody();
    $pageId = $payload['id'] ?? null;
    if (!is_int($pageId) || $pageId < 1) respond(400, ['error' => 'A Commons image ID is required']);
    $data = commonsApi([
        'pageids' => (string) $pageId, 'prop' => 'imageinfo',
        'iiprop' => 'url|mime|size|dimensions|extmetadata',
        'iiextmetadatafilter' => 'LicenseShortName|LicenseUrl|Artist|Attribution',
    ]);
    $page = $data['query']['pages'][0] ?? null;
    $info = $page['imageinfo'][0] ?? null;
    if (!is_array($page) || !is_array($info) || ($page['pageid'] ?? null) !== $pageId) {
        respond(404, ['error' => 'Commons image not found']);
    }
    $name = validQuizImageName((string) preg_replace('/^File:/', '', $page['title'] ?? ''));
    $sourcePage = commonsHttpsUrl($info['descriptionurl'] ?? null, 'commons.wikimedia.org');
    $downloadUrl = commonsHttpsUrl($info['url'] ?? null, 'upload.wikimedia.org');
    if ($sourcePage === null || $downloadUrl === null) {
        respond(422, ['error' => 'Commons image has no trusted download URL']);
    }
    if (($info['size'] ?? 0) > MEDIA_IMAGE_MAX_BYTES) {
        respond(413, ['error' => 'Image must be at most 6 MiB']);
    }
    $metadata = $info['extmetadata'] ?? [];
    $license = commonsText($metadata['LicenseShortName']['value'] ?? null, 200);
    $creator = commonsText($metadata['Artist']['value'] ?? null);
    $attribution = commonsText($metadata['Attribution']['value'] ?? null);
    $licenseUrl = $metadata['LicenseUrl']['value'] ?? null;
    if (!is_string($licenseUrl) || !str_starts_with($licenseUrl, 'https://')
        || filter_var($licenseUrl, FILTER_VALIDATE_URL) === false) $licenseUrl = null;
    if ($license === '') respond(422, ['error' => 'Commons image license is unavailable']);
    [$ok, $bytes, $tooLarge] = commonsFetch($downloadUrl, MEDIA_IMAGE_MAX_BYTES);
    if ($tooLarge) respond(413, ['error' => 'Image must be at most 6 MiB']);
    if (!$ok) respond(503, ['error' => 'Could not download Commons image']);
    [$mime, $width, $height] = validQuizImage($bytes);
    $db = connectMediaDb();
    if (@pg_query($db, 'BEGIN') === false
        || @pg_query_params($db, 'SELECT pg_advisory_xact_lock($1)', [$user['id']]) === false) {
        respond(500, ['error' => 'Failed to save image']);
    }
    ensureMediaAccountActive((int) $user['id']);
    $image = saveMediaImage($db, (int) $user['id'], $name, $bytes, $mime, $width, $height,
        reuseShared: false);
    if ($image['scope'] === 'personal') {
        saveMediaSource($db, $image['id'], [
            'page' => $sourcePage, 'creator' => $creator, 'license' => $license,
            'license_url' => $licenseUrl, 'attribution' => $attribution,
        ]);
    }
    if (@pg_query($db, 'COMMIT') === false) respond(500, ['error' => 'Failed to save image']);
    if ($image['scope'] === 'personal') {
        $storedSource = @pg_query_params($db,
            'SELECT source_page, creator, license_name, license_url, attribution
             FROM public.image_source WHERE image_id = $1', [$image['id']]);
        $row = $storedSource === false ? false : pg_fetch_assoc($storedSource);
        if ($row !== false) {
            $image['source'] = [
                'page' => $row['source_page'], 'creator' => $row['creator'],
                'license' => $row['license_name'], 'license_url' => $row['license_url'],
                'attribution' => $row['attribution'],
            ];
        }
    }
    respond(201, $image);
}
