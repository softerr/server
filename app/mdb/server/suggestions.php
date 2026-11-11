<?php
declare(strict_types=1);

function mdbSuggestionOwner(array $user, int $databaseId): void
{
    if (($user['account_kind'] ?? 'human') !== 'human') {
        respond(403, ['error' => 'Browser session required to review suggestions']);
    }
    mdbOwnedDatabase(connectMdbDb(), (int) $user['id'], $databaseId);
}

function mdbSuggestionCell($db, int $databaseId, int $rowId, int $columnId): ?array
{
    $result = @pg_query_params($db,
        'SELECT c.name, c.type, c.options, c.relation_database_id, v.value
         FROM public.database_row r
         JOIN public.database_column c ON c.database_id = r.database_id
         LEFT JOIN public.database_cell v ON v.database_id = r.database_id
             AND v.row_id = r.id AND v.column_id = c.id
         WHERE r.database_id = $1 AND r.id = $2 AND c.id = $3',
        [$databaseId, $rowId, $columnId]);
    if ($result === false) respond(500, ['error' => 'Failed to check suggested cell']);
    $row = pg_fetch_assoc($result);
    return $row === false ? null : $row;
}

function mdbSuggestionColumn($db, int $databaseId, int $columnId): ?array
{
    $result = @pg_query_params($db,
        'SELECT name, type, options, relation_database_id
         FROM public.database_column WHERE database_id = $1 AND id = $2',
        [$databaseId, $columnId]);
    if ($result === false) respond(500, ['error' => 'Failed to check suggested column']);
    $row = pg_fetch_assoc($result);
    return $row === false ? null : $row;
}

function mdbSuggestionValidateValue($db, array $column, mixed $value,
    array $requestUser, int $ownerId): array
{
    if (in_array($column['type'], ['relation', 'multi_relation'], true)
        && tokenOwnerAccess($requestUser, 'mdb', (int) $column['relation_database_id']) === null) {
        respond(403, ['error' => 'Related database is outside the token grant']);
    }
    [$stored, $public] = mdbCellStorage($db, $column, $value, $ownerId);
    if ($column['type'] === 'image' && $public !== null) {
        $image = @pg_query_params(connectMediaDb(),
            'SELECT shared FROM public.image WHERE id = $1', [$public]);
        if ($image === false) respond(500, ['error' => 'Failed to check suggested image']);
        if (pg_num_rows($image) === 0
            || (pg_fetch_result($image, 0, 'shared') !== 't'
                && !tokenOwnerImageUsable((int) $public, $requestUser, 'mdb'))) {
            respond(403, ['error' => 'Image is outside this token\'s databases']);
        }
    }
    return [$stored, $public];
}

function mdbSuggestionPublicValue(string $type, ?string $stored): mixed
{
    return $stored === null ? null : mdbPublicCellValue($type, $stored);
}

function mdbSuggestionRowSnapshot($db, int $databaseId, int $rowId): ?array
{
    $result = @pg_query_params($db,
        'SELECT position FROM public.database_row WHERE database_id = $1 AND id = $2',
        [$databaseId, $rowId]);
    if ($result === false) respond(500, ['error' => 'Failed to check suggested row']);
    $row = pg_fetch_assoc($result);
    if ($row === false) return null;
    $result = @pg_query_params($db,
        'SELECT c.id, c.name, c.type, v.value
         FROM public.database_cell v JOIN public.database_column c
           ON c.database_id = v.database_id AND c.id = v.column_id
         WHERE v.database_id = $1 AND v.row_id = $2 ORDER BY c.position',
        [$databaseId, $rowId]);
    if ($result === false) respond(500, ['error' => 'Failed to check suggested row']);
    $values = [];
    $fields = [];
    $label = null;
    while (($cell = pg_fetch_assoc($result)) !== false) {
        $value = mdbPublicCellValue($cell['type'], $cell['value']);
        $values[(string) $cell['id']] = $value;
        $fields[] = ['column_id' => (int) $cell['id'], 'column' => $cell['name'], 'value' => $value];
        if ($label === null && $cell['type'] === 'text' && trim($cell['value']) !== '') {
            $label = $cell['value'];
        }
    }
    ksort($values, SORT_NUMERIC);
    return ['position' => (int) $row['position'], 'values' => $values,
        'fields' => $fields, 'label' => $label];
}

function mdbSuggestionRowIsReferenced($db, int $databaseId, int $rowId): bool
{
    $result = @pg_query_params($db,
        'SELECT 1 FROM public.database_column c JOIN public.database_cell cell
           ON cell.database_id = c.database_id AND cell.column_id = c.id
         WHERE c.relation_database_id = $1
           AND (c.type = \'relation\' AND cell.value = $2::text
             OR c.type = \'multi_relation\' AND cell.value::jsonb @> jsonb_build_array($2::bigint))
         LIMIT 1', [$databaseId, $rowId]);
    if ($result === false) respond(500, ['error' => 'Failed to check row references']);
    return pg_num_rows($result) > 0;
}

function mdbSuggestionSummary(array $row): array
{
    return ['id' => (int) $row['id'], 'title' => $row['title'],
        'proposer' => $row['proposer_name'], 'status' => $row['status'],
        'created' => $row['created'], 'reviewed_at' => $row['reviewed_at'],
        'change_count' => (int) $row['change_count']];
}

function handleCreateMdbSuggestion(array $requestUser, int $databaseId): never
{
    if (!isset($requestUser['api_token_id'])
        || tokenOwnerAccess($requestUser, 'mdb', $databaseId) === null) {
        respond(403, ['error' => 'An API token with database read access is required']);
    }
    $payload = readJsonBody(262144);
    $title = $payload['title'] ?? null;
    $changes = $payload['changes'] ?? [];
    $rowDeletions = $payload['row_deletions'] ?? [];
    $rowCreations = $payload['row_creations'] ?? [];
    $requestId = $payload['request_id'] ?? null;
    if (!is_array($payload) || !is_string($title) || trim($title) === ''
        || strlen(trim($title)) > 100 || preg_match('//u', $title) !== 1
        || preg_match('/[\x00-\x1f\x7f]/u', $title) === 1
        || !is_array($changes) || !array_is_list($changes)
        || !is_array($rowDeletions) || !array_is_list($rowDeletions)
        || !is_array($rowCreations) || !array_is_list($rowCreations)
        || count($changes) + count($rowDeletions) + count($rowCreations) < 1
        || count($changes) + count($rowDeletions) + count($rowCreations) > 100
        || ($requestId !== null && (!is_string($requestId)
            || preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/D',
                $requestId) !== 1))) {
        respond(400, ['error' => 'Invalid suggestion']);
    }
    $db = connectMdbDb();
    $ownerId = (int) $requestUser['service_owner_id'];
    mdbBeginWrite($db, ['id' => $ownerId], $databaseId);
    $hash = hash('sha256', json_encode($payload, JSON_THROW_ON_ERROR));
    if ($requestId !== null) {
        $previous = @pg_query_params($db,
            'SELECT s.id, s.status, s.request_sha256,
                    ((SELECT COUNT(*) FROM public.cell_suggestion_change c
                      WHERE c.suggestion_id = s.id)
                     + (SELECT COUNT(*) FROM public.row_delete_suggestion d
                        WHERE d.suggestion_id = s.id)
                     + (SELECT COUNT(*) FROM public.row_create_suggestion n
                        WHERE n.suggestion_id = s.id)) AS change_count
             FROM public.cell_suggestion s
             WHERE s.token_id = $1 AND s.request_id = $2',
            [$requestUser['api_token_id'], $requestId]);
        if ($previous === false) respond(500, ['error' => 'Failed to check suggestion retry']);
        if (($prior = pg_fetch_assoc($previous)) !== false) {
            if (!hash_equals(trim($prior['request_sha256']), $hash)) {
                respond(409, ['error' => 'Request ID was used for a different suggestion']);
            }
            @pg_query($db, 'ROLLBACK');
            respond(200, ['id' => (int) $prior['id'], 'status' => $prior['status'],
                'change_count' => (int) $prior['change_count']]);
        }
    }
    $pending = @pg_query_params($db,
        'SELECT COUNT(*) FROM public.cell_suggestion
         WHERE database_id = $1 AND status = \'pending\'', [$databaseId]);
    if ($pending === false) respond(500, ['error' => 'Failed to check suggestion limit']);
    if ((int) pg_fetch_result($pending, 0, 0) >= 100) {
        respond(429, ['error' => 'This database already has 100 pending suggestions']);
    }
    $seen = [];
    $deletedRows = [];
    $validatedDeletions = [];
    foreach ($rowDeletions as $deletion) {
        $rowId = $deletion['row_id'] ?? null;
        $before = $deletion['before'] ?? null;
        $reason = $deletion['reason'] ?? null;
        if (!is_array($deletion) || !is_int($rowId) || $rowId < 1
            || !array_key_exists('before', $deletion) || !is_array($before)
            || ($before !== [] && array_is_list($before))
            || !is_string($reason) || trim($reason) === '' || strlen(trim($reason)) > 500
            || preg_match('//u', $reason) !== 1
            || preg_match('/[\x00-\x1f\x7f]/u', $reason) === 1
            || isset($deletedRows[$rowId])) {
            respond(400, ['error' => 'Invalid suggested row deletion']);
        }
        $deletedRows[$rowId] = true;
        $snapshot = mdbSuggestionRowSnapshot($db, $databaseId, $rowId);
        if ($snapshot === null) respond(404, ['error' => 'Suggested row not found']);
        ksort($before, SORT_NUMERIC);
        if ($before !== $snapshot['values']) {
            respond(409, ['error' => 'A suggested row has changed; reload the database']);
        }
        $validatedDeletions[] = [$rowId,
            json_encode((object) $snapshot['values'], JSON_THROW_ON_ERROR),
            json_encode($snapshot['fields'], JSON_THROW_ON_ERROR),
            $snapshot['label'], trim($reason)];
    }
    $validated = [];
    foreach ($changes as $change) {
        $rowId = $change['row_id'] ?? null;
        $columnId = $change['column_id'] ?? null;
        $reason = $change['reason'] ?? null;
        if (!is_array($change) || !is_int($rowId) || $rowId < 1
            || !is_int($columnId) || $columnId < 1
            || !array_key_exists('before', $change) || !array_key_exists('value', $change)
            || !is_string($reason) || trim($reason) === '' || strlen(trim($reason)) > 500
            || preg_match('//u', $reason) !== 1
            || preg_match('/[\x00-\x1f\x7f]/u', $reason) === 1
            || isset($seen["$rowId:$columnId"]) || isset($deletedRows[$rowId])) {
            respond(400, ['error' => 'Invalid suggested cell']);
        }
        $seen["$rowId:$columnId"] = true;
        $column = mdbSuggestionCell($db, $databaseId, $rowId, $columnId);
        if ($column === null) respond(404, ['error' => 'Suggested row or column not found']);
        if ($change['before'] !== mdbSuggestionPublicValue($column['type'], $column['value'])) {
            respond(409, ['error' => 'A suggested cell has changed; reload the database']);
        }
        [$stored, $public] = mdbSuggestionValidateValue($db, $column,
            $change['value'], $requestUser, $ownerId);
        if ($stored === $column['value']) respond(400, ['error' => 'Suggestion contains no change']);
        $validated[] = [$rowId, $columnId, $column['name'], $column['type'],
            $column['value'], json_encode($public, JSON_THROW_ON_ERROR), trim($reason)];
    }
    $validatedCreations = [];
    foreach ($rowCreations as $creation) {
        $values = $creation['values'] ?? null;
        $reason = $creation['reason'] ?? null;
        if (!is_array($creation) || !is_array($values) || $values === []
            || array_is_list($values) || !is_string($reason) || trim($reason) === ''
            || strlen(trim($reason)) > 500 || preg_match('//u', $reason) !== 1
            || preg_match('/[\x00-\x1f\x7f]/u', $reason) === 1) {
            respond(400, ['error' => 'Invalid suggested row creation']);
        }
        $fields = [];
        $publicValues = [];
        $nonempty = false;
        foreach ($values as $key => $value) {
            if (filter_var((string) $key, FILTER_VALIDATE_INT,
                ['options' => ['min_range' => 1]]) === false) {
                respond(400, ['error' => 'Invalid suggested column ID']);
            }
            $columnId = (int) $key;
            $column = mdbSuggestionColumn($db, $databaseId, $columnId);
            if ($column === null) respond(404, ['error' => 'Suggested column not found']);
            [$stored, $public] = mdbSuggestionValidateValue($db, $column,
                $value, $requestUser, $ownerId);
            $nonempty = $nonempty || $public !== null;
            $publicValues[(string) $columnId] = $public;
            $fields[] = ['column_id' => $columnId, 'column' => $column['name'],
                'type' => $column['type'], 'options' => json_decode((string) $column['options'], true),
                'relation_database_id' => $column['relation_database_id'] === null
                    ? null : (int) $column['relation_database_id'], 'value' => $public];
        }
        if (!$nonempty) respond(400, ['error' => 'Suggested row must have a value']);
        usort($fields, static fn (array $a, array $b): int => $a['column_id'] <=> $b['column_id']);
        ksort($publicValues, SORT_NUMERIC);
        $validatedCreations[] = [json_encode((object) $publicValues, JSON_THROW_ON_ERROR),
            json_encode($fields, JSON_THROW_ON_ERROR), trim($reason)];
    }
    $inserted = @pg_query_params($db,
        'INSERT INTO public.cell_suggestion
            (database_id, token_id, proposer_name, title, request_id, request_sha256)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
        [$databaseId, $requestUser['api_token_id'], $requestUser['username'], trim($title),
         $requestId, $requestId === null ? null : $hash]);
    if ($inserted === false) respond(500, ['error' => 'Failed to create suggestion']);
    $suggestionId = (int) pg_fetch_result($inserted, 0, 0);
    foreach ($validated as $change) {
        $saved = @pg_query_params($db,
            'INSERT INTO public.cell_suggestion_change
                (suggestion_id, row_id, column_id, column_name, column_type,
                 before_value, proposed_value, reason)
             VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)',
            [$suggestionId, ...$change]);
        if ($saved === false) respond(500, ['error' => 'Failed to save suggested cells']);
    }
    foreach ($validatedDeletions as $deletion) {
        $saved = @pg_query_params($db,
            'INSERT INTO public.row_delete_suggestion
                (suggestion_id, row_id, before_values, before_fields, row_label, reason)
             VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6)',
            [$suggestionId, ...$deletion]);
        if ($saved === false) respond(500, ['error' => 'Failed to save suggested row deletion']);
    }
    foreach ($validatedCreations as $index => $creation) {
        $saved = @pg_query_params($db,
            'INSERT INTO public.row_create_suggestion
                (suggestion_id, item_index, proposed_values, proposed_fields, reason)
             VALUES ($1, $2, $3::jsonb, $4::jsonb, $5)',
            [$suggestionId, $index + 1, ...$creation]);
        if ($saved === false) respond(500, ['error' => 'Failed to save suggested row creation']);
    }
    if (@pg_query($db, 'COMMIT') === false) respond(500, ['error' => 'Failed to create suggestion']);
    respond(201, ['id' => $suggestionId, 'status' => 'pending',
        'change_count' => count($validated) + count($validatedDeletions) + count($validatedCreations)]);
}

function handleListMdbSuggestions(array $user, int $databaseId): never
{
    mdbSuggestionOwner($user, $databaseId);
    $result = @pg_query_params(connectMdbDb(),
        'SELECT s.id, s.title, s.proposer_name, s.status, s.created, s.reviewed_at,
                ((SELECT COUNT(*) FROM public.cell_suggestion_change c
                  WHERE c.suggestion_id = s.id)
                 + (SELECT COUNT(*) FROM public.row_delete_suggestion d
                    WHERE d.suggestion_id = s.id)
                 + (SELECT COUNT(*) FROM public.row_create_suggestion n
                    WHERE n.suggestion_id = s.id)) AS change_count
         FROM public.cell_suggestion s
         WHERE s.database_id = $1
         ORDER BY (s.status = \'pending\') DESC, s.id DESC LIMIT 100',
        [$databaseId]);
    if ($result === false) respond(500, ['error' => 'Failed to list suggestions']);
    $items = [];
    while (($row = pg_fetch_assoc($result)) !== false) $items[] = mdbSuggestionSummary($row);
    respond(200, ['suggestions' => $items]);
}

function handleGetMdbSuggestion(array $user, int $databaseId, int $suggestionId): never
{
    mdbSuggestionOwner($user, $databaseId);
    $db = connectMdbDb();
    $result = @pg_query_params($db,
        'SELECT s.id, s.title, s.proposer_name, s.status, s.created, s.reviewed_at,
                ((SELECT COUNT(*) FROM public.cell_suggestion_change c
                  WHERE c.suggestion_id = s.id)
                 + (SELECT COUNT(*) FROM public.row_delete_suggestion d
                    WHERE d.suggestion_id = s.id)
                 + (SELECT COUNT(*) FROM public.row_create_suggestion n
                    WHERE n.suggestion_id = s.id)) AS change_count
         FROM public.cell_suggestion s
         WHERE s.database_id = $1 AND s.id = $2',
        [$databaseId, $suggestionId]);
    if ($result === false) respond(500, ['error' => 'Failed to load suggestion']);
    $summary = pg_fetch_assoc($result);
    if ($summary === false) respond(404, ['error' => 'Suggestion not found']);
    $result = @pg_query_params($db,
        'SELECT suggested.row_id, suggested.column_id, suggested.column_name,
                suggested.column_type, suggested.before_value, suggested.proposed_value,
                suggested.reason, current_row.position AS row_position,
                (SELECT cell.value FROM public.database_column column_def
                 JOIN public.database_cell cell ON cell.database_id = column_def.database_id
                     AND cell.column_id = column_def.id AND cell.row_id = suggested.row_id
                 WHERE column_def.database_id = $2 AND column_def.type = \'text\'
                     AND btrim(cell.value) <> \'\'
                 ORDER BY column_def.position LIMIT 1) AS row_label
         FROM public.cell_suggestion_change suggested
         LEFT JOIN public.database_row current_row ON current_row.database_id = $2
             AND current_row.id = suggested.row_id
         WHERE suggested.suggestion_id = $1
         ORDER BY suggested.row_id, suggested.column_id',
        [$suggestionId, $databaseId]);
    if ($result === false) respond(500, ['error' => 'Failed to load suggested cells']);
    $changes = [];
    while (($row = pg_fetch_assoc($result)) !== false) {
        $changes[] = ['kind' => 'cell', 'row_id' => (int) $row['row_id'],
            'row_position' => $row['row_position'] === null ? null : (int) $row['row_position'],
            'row_label' => $row['row_label'], 'column_id' => (int) $row['column_id'],
            'column' => $row['column_name'], 'type' => $row['column_type'],
            'before' => mdbSuggestionPublicValue($row['column_type'], $row['before_value']),
            'value' => json_decode($row['proposed_value'], true), 'reason' => $row['reason']];
    }
    $result = @pg_query_params($db,
        'SELECT d.row_id, d.before_values, d.before_fields, d.row_label, d.reason,
                r.position AS row_position
         FROM public.row_delete_suggestion d
         LEFT JOIN public.database_row r ON r.database_id = $2 AND r.id = d.row_id
         WHERE d.suggestion_id = $1 ORDER BY d.row_id',
        [$suggestionId, $databaseId]);
    if ($result === false) respond(500, ['error' => 'Failed to load suggested row deletions']);
    while (($row = pg_fetch_assoc($result)) !== false) {
        $changes[] = ['kind' => 'row_delete', 'row_id' => (int) $row['row_id'],
            'row_position' => $row['row_position'] === null ? null : (int) $row['row_position'],
            'row_label' => $row['row_label'], 'before' => (object) json_decode($row['before_values'], true),
            'fields' => json_decode($row['before_fields'], true), 'reason' => $row['reason']];
    }
    usort($changes, static fn (array $a, array $b): int => $a['row_id'] <=> $b['row_id']);
    $result = @pg_query_params($db,
        'SELECT item_index, proposed_fields, reason FROM public.row_create_suggestion
         WHERE suggestion_id = $1 ORDER BY item_index', [$suggestionId]);
    if ($result === false) respond(500, ['error' => 'Failed to load suggested row creations']);
    while (($row = pg_fetch_assoc($result)) !== false) {
        $fields = array_map(static fn (array $field): array =>
            ['column_id' => $field['column_id'], 'column' => $field['column'],
                'value' => $field['value']], json_decode($row['proposed_fields'], true));
        $changes[] = ['kind' => 'row_create', 'item_index' => (int) $row['item_index'],
            'fields' => $fields, 'reason' => $row['reason']];
    }
    respond(200, ['suggestion' => mdbSuggestionSummary($summary), 'changes' => $changes]);
}

function handleReviewMdbSuggestion(array $user, int $databaseId, int $suggestionId,
    string $decision): never
{
    mdbSuggestionOwner($user, $databaseId);
    $db = connectMdbDb();
    // Accepted suggestions may delete rows and must exclude concurrent
    // writes to referencing databases until their references are checked.
    mdbBeginWrite($db, $user, $databaseId, [], $decision === 'accepted');
    $result = @pg_query_params($db,
        'SELECT status FROM public.cell_suggestion WHERE id = $1 AND database_id = $2 FOR UPDATE',
        [$suggestionId, $databaseId]);
    if ($result === false) respond(500, ['error' => 'Failed to review suggestion']);
    $row = pg_fetch_assoc($result);
    if ($row === false) respond(404, ['error' => 'Suggestion not found']);
    if ($row['status'] !== 'pending') respond(409, ['error' => 'Suggestion was already reviewed']);
    if ($decision === 'accepted') {
        $result = @pg_query_params($db,
            'SELECT row_id, column_id, column_name, column_type, before_value, proposed_value
             FROM public.cell_suggestion_change WHERE suggestion_id = $1
             ORDER BY row_id, column_id', [$suggestionId]);
        if ($result === false) respond(500, ['error' => 'Failed to load suggested cells']);
        $writes = [];
        while (($change = pg_fetch_assoc($result)) !== false) {
            $column = mdbSuggestionCell($db, $databaseId,
                (int) $change['row_id'], (int) $change['column_id']);
            if ($column === null || $column['type'] !== $change['column_type']
                || $column['name'] !== $change['column_name']
                || $column['value'] !== $change['before_value']) {
                respond(409, ['error' => 'Suggestion is stale; a row or column changed']);
            }
            [$stored] = mdbCellStorage($db, $column,
                json_decode($change['proposed_value'], true), (int) $user['id']);
            $writes[] = [(int) $change['row_id'], (int) $change['column_id'], $stored];
        }
        $result = @pg_query_params($db,
            'SELECT row_id, before_values, before_fields
             FROM public.row_delete_suggestion WHERE suggestion_id = $1 ORDER BY row_id',
            [$suggestionId]);
        if ($result === false) respond(500, ['error' => 'Failed to load suggested row deletions']);
        $deletions = [];
        while (($deletion = pg_fetch_assoc($result)) !== false) {
            $rowId = (int) $deletion['row_id'];
            $snapshot = mdbSuggestionRowSnapshot($db, $databaseId, $rowId);
            $beforeValues = json_decode($deletion['before_values'], true);
            ksort($beforeValues, SORT_NUMERIC);
            $fields = static fn (array $items): array => array_map(
                static fn (array $item): array =>
                    [$item['column_id'], $item['column'], $item['value']], $items);
            if ($snapshot === null
                || $snapshot['values'] !== $beforeValues
                || $fields($snapshot['fields']) !== $fields(json_decode($deletion['before_fields'], true))) {
                respond(409, ['error' => 'Suggestion is stale; a row changed']);
            }
            $deletions[] = $rowId;
        }
        $result = @pg_query_params($db,
            'SELECT item_index, proposed_values, proposed_fields
             FROM public.row_create_suggestion WHERE suggestion_id = $1 ORDER BY item_index',
            [$suggestionId]);
        if ($result === false) respond(500, ['error' => 'Failed to load suggested row creations']);
        $creations = [];
        while (($creation = pg_fetch_assoc($result)) !== false) {
            $fields = json_decode($creation['proposed_fields'], true);
            $values = json_decode($creation['proposed_values'], true);
            $cells = [];
            foreach ($fields as $field) {
                $columnId = (int) $field['column_id'];
                $column = mdbSuggestionColumn($db, $databaseId, $columnId);
                if ($column === null || $column['name'] !== $field['column']
                    || $column['type'] !== $field['type']
                    || json_decode((string) $column['options'], true) !== $field['options']
                    || ($column['relation_database_id'] === null
                        ? null : (int) $column['relation_database_id']) !== $field['relation_database_id']
                    || !array_key_exists((string) $columnId, $values)
                    || $values[(string) $columnId] !== $field['value']) {
                    respond(409, ['error' => 'Suggestion is stale; a column changed']);
                }
                [$stored] = mdbCellStorage($db, $column, $field['value'], (int) $user['id']);
                if ($stored !== null) $cells[] = [$columnId, $stored];
            }
            $creations[] = $cells;
        }
        foreach ($writes as [$rowId, $columnId, $stored]) {
            $saved = $stored === null
                ? @pg_query_params($db,
                    'DELETE FROM public.database_cell
                     WHERE database_id = $1 AND row_id = $2 AND column_id = $3',
                    [$databaseId, $rowId, $columnId])
                : @pg_query_params($db,
                    'INSERT INTO public.database_cell (database_id, row_id, column_id, value)
                     VALUES ($1, $2, $3, $4)
                     ON CONFLICT (row_id, column_id) DO UPDATE SET value = EXCLUDED.value',
                    [$databaseId, $rowId, $columnId, $stored]);
            if ($saved === false) respond(500, ['error' => 'Failed to apply suggestion']);
        }
        if ($creations !== []) {
            $maximum = @pg_query_params($db,
                'SELECT COALESCE(MAX(position), 0) FROM public.database_row WHERE database_id = $1',
                [$databaseId]);
            if ($maximum === false) respond(500, ['error' => 'Failed to add suggested rows']);
            $position = (int) pg_fetch_result($maximum, 0, 0);
            if ($position > PHP_INT_MAX - count($creations)) {
                respond(409, ['error' => 'No room to add suggested rows']);
            }
            foreach ($creations as $cells) {
                $created = @pg_query_params($db,
                    'INSERT INTO public.database_row (database_id, position)
                     VALUES ($1, $2) RETURNING id', [$databaseId, ++$position]);
                if ($created === false) respond(500, ['error' => 'Failed to add suggested row']);
                $rowId = (int) pg_fetch_result($created, 0, 0);
                foreach ($cells as [$columnId, $stored]) {
                    $saved = @pg_query_params($db,
                        'INSERT INTO public.database_cell (database_id, row_id, column_id, value)
                         VALUES ($1, $2, $3, $4)', [$databaseId, $rowId, $columnId, $stored]);
                    if ($saved === false) respond(500, ['error' => 'Failed to add suggested row value']);
                }
            }
        }
        foreach ($deletions as $rowId) {
            if (mdbSuggestionRowIsReferenced($db, $databaseId, $rowId)) {
                respond(409, ['error' => 'Row is still used by another database cell']);
            }
        }
        foreach ($deletions as $rowId) {
            $deleted = @pg_query_params($db,
                'DELETE FROM public.database_row WHERE database_id = $1 AND id = $2
                 RETURNING position', [$databaseId, $rowId]);
            if ($deleted === false || pg_num_rows($deleted) === 0) {
                respond(500, ['error' => 'Failed to delete suggested row']);
            }
            mdbCompactPositionsAfterDelete($db, 'public.database_row', $databaseId,
                (int) pg_fetch_result($deleted, 0, 'position'), PHP_INT_MAX);
        }
    }
    $updated = @pg_query_params($db,
        'UPDATE public.cell_suggestion SET status = $1, reviewed_at = CURRENT_TIMESTAMP
         WHERE id = $2', [$decision, $suggestionId]);
    if ($updated === false || @pg_query($db, 'COMMIT') === false) {
        respond(500, ['error' => 'Failed to review suggestion']);
    }
    respond(200, ['id' => $suggestionId, 'status' => $decision]);
}
