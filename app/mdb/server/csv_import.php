<?php
declare(strict_types=1);

const MDB_CSV_MAX_BYTES = 8388608;
const MDB_CSV_MAX_COLUMNS = 100;
const MDB_CSV_MAX_ROWS = 10000;
const MDB_CSV_MAX_CELLS = 100000;

function mdbCsvRead(): array
{
    $file = $_FILES['file'] ?? null;
    if (!is_array($file) || ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        if (in_array($file['error'] ?? null, [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true)) {
            respond(413, ['error' => 'CSV file is too large']);
        }
        respond(400, ['error' => 'Choose a CSV file']);
    }
    if (!is_int($file['size'] ?? null) || $file['size'] > MDB_CSV_MAX_BYTES) {
        respond(413, ['error' => 'CSV file is too large (8 MiB maximum)']);
    }
    if (!is_string($file['tmp_name'] ?? null) || !is_uploaded_file($file['tmp_name'])) {
        respond(400, ['error' => 'Invalid CSV upload']);
    }
    $stream = @fopen($file['tmp_name'], 'rb');
    if ($stream === false) respond(400, ['error' => 'Could not read CSV file']);
    $delimiter = ',';
    $mostFields = 0;
    foreach ([',', ';', "\t"] as $candidate) {
        rewind($stream);
        $header = fgetcsv($stream, 0, $candidate, '"', '');
        if (is_array($header) && count($header) > $mostFields) {
            $mostFields = count($header);
            $delimiter = $candidate;
        }
    }
    rewind($stream);
    $header = fgetcsv($stream, 0, $delimiter, '"', '');
    if (!is_array($header) || $header === [null] || count($header) > MDB_CSV_MAX_COLUMNS) {
        respond(400, ['error' => 'CSV needs a header with at most 100 columns']);
    }
    $header[0] = preg_replace('/^\xEF\xBB\xBF/', '', (string) $header[0]);
    $headers = [];
    $seen = [];
    foreach ($header as $name) {
        $name = mdbName($name);
        $key = function_exists('mb_strtolower') ? mb_strtolower($name, 'UTF-8') : strtolower($name);
        if (isset($seen[$key])) respond(400, ['error' => 'CSV column names must be unique']);
        $seen[$key] = true;
        $headers[] = $name;
    }
    $rows = [];
    $line = 1;
    while (($values = fgetcsv($stream, 0, $delimiter, '"', '')) !== false) {
        $line++;
        if ($values === [null]) continue;
        if (count($values) !== count($headers)) {
            respond(400, ['error' => "CSV row {$line} has the wrong number of columns"]);
        }
        $row = [];
        foreach ($values as $value) {
            $value = trim((string) $value);
            if (strlen($value) > 60000 || str_contains($value, "\0") || preg_match('//u', $value) !== 1) {
                respond(400, ['error' => "CSV row {$line} contains an invalid or oversized value"]);
            }
            $row[] = $value;
        }
        if (count(array_filter($row, static fn (string $value): bool => $value !== '')) === 0) continue;
        $rows[] = $row;
        if (count($rows) > MDB_CSV_MAX_ROWS) respond(413, ['error' => 'CSV has too many rows (10000 maximum)']);
        if (count($rows) * count($headers) > MDB_CSV_MAX_CELLS) {
            respond(413, ['error' => 'CSV has too many cells (100000 maximum)']);
        }
    }
    fclose($stream);
    return [$headers, $rows];
}

function mdbCsvDate(string $value): ?string
{
    foreach (['!Y-m-d', '!Y/m/d', '!F j, Y', '!M j, Y', '!j F Y', '!j M Y'] as $format) {
        $date = DateTimeImmutable::createFromFormat($format, $value, new DateTimeZone('UTC'));
        $errors = DateTimeImmutable::getLastErrors();
        if ($date !== false && ($errors === false || ($errors['warning_count'] === 0 && $errors['error_count'] === 0))) {
            return $date->format('Y-m-d');
        }
    }
    return null;
}

function mdbCsvBoolean(string $value): ?bool
{
    return match (strtolower($value)) {
        'true', 'yes', '1' => true,
        'false', 'no', '0' => false,
        default => null,
    };
}

function mdbCsvOptions(string $type, string $value): array
{
    if ($value === '') return [];
    $parts = $type === 'multi_select' ? explode(',', $value) : [$value];
    $options = [];
    foreach ($parts as $part) {
        $part = trim($part);
        if ($part === '') continue;
        $name = mdbName($part);
        if (!in_array($name, $options, true)) $options[] = $name;
    }
    return $options;
}

function mdbCsvCandidates(array $values): array
{
    $nonempty = array_values(array_filter($values, static fn (string $value): bool => $value !== ''));
    if ($nonempty === []) return [['text', 'number', 'date', 'checkbox', 'relation', 'multi_relation'], null];
    $number = true;
    $date = true;
    $checkbox = true;
    $select = true;
    $multiSelect = true;
    foreach ($nonempty as $value) {
        $number = $number && strlen($value) <= 100 && preg_match(
            '/^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/D', $value) === 1;
        $date = $date && mdbCsvDate($value) !== null;
        $checkbox = $checkbox && mdbCsvBoolean($value) !== null;
        $select = $select && strlen($value) <= 100 && !preg_match('/[\x00-\x1f\x7f]/u', $value);
        foreach (explode(',', $value) as $part) {
            $part = trim($part);
            $multiSelect = $multiSelect && $part !== '' && strlen($part) <= 100
                && !preg_match('/[\x00-\x1f\x7f]/u', $part);
        }
    }
    $candidates = ['text'];
    if ($number) $candidates[] = 'number';
    if ($date) $candidates[] = 'date';
    if ($checkbox) $candidates[] = 'checkbox';
    if ($select) $candidates[] = 'select';
    if ($multiSelect) $candidates[] = 'multi_select';
    $candidates[] = 'relation';
    $candidates[] = 'multi_relation';
    $inferred = $date && !$number && !$checkbox ? 'date'
        : ($number && !$checkbox ? 'number' : ($checkbox && !$number ? 'checkbox' : null));
    if ($inferred === null && !$number && !$date && !$checkbox && !$select && !$multiSelect) {
        $inferred = 'text';
    }
    return [$candidates, $inferred];
}

function mdbCsvColumnPlans($db, int $databaseId, array $headers, array $rows): array
{
    $plans = [];
    $seen = [];
    foreach ($headers as $index => $name) {
        $folded = @pg_query_params($db, 'SELECT lower($1::text)', [$name]);
        if ($folded === false) respond(500, ['error' => 'Failed to inspect CSV columns']);
        $key = pg_fetch_result($folded, 0, 0);
        if (isset($seen[$key])) respond(400, ['error' => 'CSV column names must be unique']);
        $seen[$key] = true;
        $result = @pg_query_params($db,
            'SELECT id, name, type, options, relation_database_id, relation_display_column_id
             FROM public.database_column
             WHERE database_id = $1 AND lower(name) = lower($2)', [$databaseId, $name]);
        if ($result === false) respond(500, ['error' => 'Failed to inspect CSV columns']);
        $existing = pg_fetch_assoc($result) ?: null;
        $values = array_column($rows, $index);
        [$candidates, $inferred] = mdbCsvCandidates($values);
        $samples = [];
        foreach ($values as $value) {
            if ($value !== '' && !in_array($value, $samples, true)) {
                preg_match('/^.{0,80}/us', $value, $sample);
                $samples[] = $sample[0] ?? '';
            }
            if (count($samples) === 3) break;
        }
        $plans[] = ['name' => $name, 'index' => $index, 'existing' => $existing,
            'candidates' => $candidates, 'inferred_type' => $existing['type'] ?? $inferred,
            'samples' => $samples];
    }
    return $plans;
}

function handlePreviewMdbCsv(array $user, int $databaseId): never
{
    [$headers, $rows] = mdbCsvRead();
    $db = connectMdbDb();
    mdbOwnedDatabase($db, (int) $user['id'], $databaseId);
    $plans = mdbCsvColumnPlans($db, $databaseId, $headers, $rows);
    respond(200, ['row_count' => count($rows), 'columns' => array_map(
        static fn (array $plan): array => ['name' => $plan['name'],
            'existing' => $plan['existing'] !== null,
            'type' => $plan['inferred_type'], 'candidates' => $plan['candidates'],
            'relation_database_id' => $plan['existing']['relation_database_id'] ?? null,
            'relation_display_column_id' => $plan['existing']['relation_display_column_id'] ?? null,
            'samples' => $plan['samples']], $plans)]);
}

function mdbCsvStoredValue($db, string $type, array $options, string $raw, string $columnName, int $line): ?string
{
    if ($raw === '') return null;
    if ($type === 'date') {
        $date = mdbCsvDate($raw);
        if ($date === null) respond(400, ['error' => "Row {$line}: invalid date in {$columnName}"]);
        return $date;
    }
    if ($type === 'checkbox') {
        $value = mdbCsvBoolean($raw);
        if ($value === null) respond(400, ['error' => "Row {$line}: invalid checkbox in {$columnName}"]);
        return $value ? 'true' : null;
    }
    if ($type === 'select') return mdbCsvOptions($type, $raw)[0] ?? null;
    if ($type === 'multi_select') {
        $selected = mdbCsvOptions($type, $raw);
        $ordered = array_values(array_filter($options,
            static fn (string $option): bool => in_array($option, $selected, true)));
        return $ordered === [] ? null : json_encode($ordered);
    }
    return mdbCellStorage($db, ['type' => $type], $raw)[0];
}

function mdbCsvRelationPlan($db, array $user, ?array $existing, mixed $settings, string $name): array
{
    if (!is_array($settings)) respond(400, ['error' => "Choose a lookup column for {$name}"]);
    $targetId = $existing === null ? ($settings['database_id'] ?? null) : $existing['relation_database_id'];
    $targetId = filter_var($targetId, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    $lookupId = filter_var($settings['lookup_column_id'] ?? null, FILTER_VALIDATE_INT,
        ['options' => ['min_range' => 1]]);
    if ($targetId === false || $lookupId === false) {
        respond(400, ['error' => "Choose a related database and lookup column for {$name}"]);
    }
    if ($existing !== null && isset($settings['database_id'])
        && (string) $settings['database_id'] !== (string) $targetId) {
        respond(400, ['error' => "Related database cannot change for {$name}"]);
    }
    mdbOwnedDatabase($db, (int) $user['id'], (int) $targetId);
    $result = @pg_query_params($db,
        'SELECT id, type, options FROM public.database_column WHERE database_id = $1 AND id = $2',
        [$targetId, $lookupId]);
    if ($result === false) respond(500, ['error' => 'Failed to inspect related column']);
    $lookup = pg_fetch_assoc($result);
    if ($lookup === false || !in_array($lookup['type'], ['text', 'number', 'date', 'select'], true)) {
        respond(400, ['error' => "Choose a text, number, date, or select lookup column for {$name}"]);
    }
    return ['database_id' => (int) $targetId, 'lookup_column_id' => (int) $lookupId,
        'lookup_type' => $lookup['type'], 'options' => json_decode($lookup['options'], true) ?: []];
}

function mdbCsvRelationParts(string $type, string $raw, string $name, int $line): array
{
    if ($raw === '') return [];
    $parts = $type === 'relation' ? [$raw] : explode(',', $raw);
    $values = [];
    foreach ($parts as $part) {
        $value = trim($part);
        if ($value === '' || in_array($value, $values, true)) {
            respond(400, ['error' => "Row {$line}: invalid or repeated related value in {$name}"]);
        }
        $values[] = $value;
    }
    return $values;
}

function mdbCsvRelatedValue($db, array $relation, string $raw, string $name, int $line): string
{
    if ($relation['lookup_type'] === 'select') return mdbName($raw);
    $value = mdbCsvStoredValue($db, $relation['lookup_type'], [], $raw, $name, $line);
    if ($value === null) respond(400, ['error' => "Row {$line}: invalid related value in {$name}"]);
    return $value;
}

function mdbCsvResolveRelation($db, array $relation, string $type, string $raw,
    string $name, int $line, array &$indexes, int &$relatedRowsAdded, int &$optionsAdded): ?string
{
    $parts = mdbCsvRelationParts($type, $raw, $name, $line);
    if ($parts === []) return null;
    $targetId = $relation['database_id'];
    $lookupId = $relation['lookup_column_id'];
    $indexKey = "{$targetId}:{$lookupId}";
    if (!isset($indexes[$indexKey])) {
        $result = @pg_query_params($db,
            'SELECT r.id, r.position, c.value FROM public.database_row r
             LEFT JOIN public.database_cell c ON c.database_id = r.database_id
               AND c.row_id = r.id AND c.column_id = $2
             WHERE r.database_id = $1 ORDER BY r.position', [$targetId, $lookupId]);
        if ($result === false) respond(500, ['error' => 'Failed to search related rows']);
        $matches = [];
        $maximum = 0;
        while (($row = pg_fetch_assoc($result)) !== false) {
            $maximum = max($maximum, (int) $row['position']);
            if ($row['value'] === null) continue;
            $key = $row['value'];
            $matches[$key] = array_key_exists($key, $matches) ? null : (int) $row['id'];
        }
        $indexes[$indexKey] = ['matches' => $matches, 'position' => $maximum,
            'options' => $relation['options']];
    }
    $index = &$indexes[$indexKey];
    $ids = [];
    foreach ($parts as $part) {
        $value = mdbCsvRelatedValue($db, $relation, $part, $name, $line);
        if (array_key_exists($value, $index['matches'])) {
            if ($index['matches'][$value] === null) {
                respond(409, ['error' => "Row {$line}: more than one related row matches {$value} in {$name}"]);
            }
            $ids[] = $index['matches'][$value];
            continue;
        }
        if ($relation['lookup_type'] === 'select' && !in_array($value, $index['options'], true)) {
            $index['options'][] = $value;
            $updated = @pg_query_params($db,
                'UPDATE public.database_column SET options = $3::jsonb WHERE database_id = $1 AND id = $2',
                [$targetId, $lookupId, json_encode($index['options'])]);
            if ($updated === false) respond(500, ['error' => 'Failed to extend related options']);
            $optionsAdded++;
        }
        if ($index['position'] >= PHP_INT_MAX) respond(409, ['error' => 'No room to add related rows']);
        $index['position']++;
        $created = @pg_query_params($db,
            'INSERT INTO public.database_row (database_id, position) VALUES ($1, $2) RETURNING id',
            [$targetId, $index['position']]);
        if ($created === false) respond(500, ['error' => 'Failed to add related row']);
        $id = (int) pg_fetch_result($created, 0, 0);
        $cell = @pg_query_params($db,
            'INSERT INTO public.database_cell (database_id, row_id, column_id, value) VALUES ($1, $2, $3, $4)',
            [$targetId, $id, $lookupId, $value]);
        if ($cell === false) respond(500, ['error' => 'Failed to add related value']);
        $index['matches'][$value] = $id;
        $relatedRowsAdded++;
        $ids[] = $id;
    }
    return $type === 'relation' ? (string) $ids[0] : json_encode($ids);
}

function mdbCsvInsertCells($db, int $databaseId, array $cells): void
{
    if ($cells === []) return;
    $result = @pg_query_params($db,
        'INSERT INTO public.database_cell (database_id, row_id, column_id, value)
         SELECT $1, item.row_id, item.column_id, item.value
         FROM jsonb_to_recordset($2::jsonb) AS item(row_id bigint, column_id bigint, value text)',
        [$databaseId, json_encode($cells)]);
    if ($result === false) respond(500, ['error' => 'Failed to import CSV cells']);
}

function handleImportMdbCsv(array $user, int $databaseId): never
{
    [$headers, $rows] = mdbCsvRead();
    $types = json_decode((string) ($_POST['types'] ?? '{}'), true);
    if (!is_array($types)) respond(400, ['error' => 'Invalid column types']);
    $relations = json_decode((string) ($_POST['relations'] ?? '{}'), true);
    if (!is_array($relations)) respond(400, ['error' => 'Invalid relation settings']);
    $db = connectMdbDb();
    mdbBeginWrite($db, $user, $databaseId);
    $plans = mdbCsvColumnPlans($db, $databaseId, $headers, $rows);
    $positionResult = @pg_query_params($db,
        'SELECT COALESCE(MAX(position), 0) FROM public.database_column WHERE database_id = $1', [$databaseId]);
    if ($positionResult === false) respond(500, ['error' => 'Failed to import CSV columns']);
    $columnPosition = (int) pg_fetch_result($positionResult, 0, 0);
    $columnsAdded = 0;
    $optionsAdded = 0;
    $relatedRowsAdded = 0;
    foreach ($plans as &$plan) {
        $existing = $plan['existing'];
        $type = $existing['type'] ?? ($types[$plan['name']] ?? $plan['inferred_type']);
        if (!is_string($type) || ($existing === null && !in_array($type, $plan['candidates'], true))) {
            respond(400, ['error' => "Choose a valid type for {$plan['name']}"]);
        }
        $relation = in_array($type, ['relation', 'multi_relation'], true)
            ? mdbCsvRelationPlan($db, $user, $existing, $relations[$plan['name']] ?? null, $plan['name'])
            : null;
        $options = $existing === null ? [] : (json_decode($existing['options'], true) ?: []);
        if (in_array($type, ['select', 'multi_select'], true)) {
            foreach ($rows as $csvRow) {
                foreach (mdbCsvOptions($type, $csvRow[$plan['index']]) as $option) {
                    if (!in_array($option, $options, true)) { $options[] = $option; $optionsAdded++; }
                }
            }
            if ($options === []) respond(400, ['error' => "Add values before choosing {$type} for {$plan['name']}"]);
        }
        if ($existing === null) {
            $columnPosition++;
            $created = @pg_query_params($db,
                'INSERT INTO public.database_column
                   (database_id, name, position, type, options, relation_database_id, relation_display_column_id)
                 VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7) RETURNING id',
                [$databaseId, $plan['name'], $columnPosition, $type, json_encode($options),
                    $relation['database_id'] ?? null, $relation['lookup_column_id'] ?? null]);
            if ($created === false) respond(500, ['error' => 'Failed to import CSV columns']);
            $plan['id'] = (int) pg_fetch_result($created, 0, 0);
            $columnsAdded++;
        } else {
            $plan['id'] = (int) $existing['id'];
            if (in_array($type, ['select', 'multi_select'], true)
                && $options !== (json_decode($existing['options'], true) ?: [])) {
                $updated = @pg_query_params($db,
                    'UPDATE public.database_column SET options = $3::jsonb WHERE database_id = $1 AND id = $2',
                    [$databaseId, $plan['id'], json_encode($options)]);
                if ($updated === false) respond(500, ['error' => 'Failed to extend CSV options']);
            }
        }
        $plan['type'] = $type;
        $plan['options'] = $options;
        $plan['relation'] = $relation;
    }
    unset($plan);
    $existingRows = @pg_query_params($db,
        'SELECT row.id AS row_id, cell.column_id, cell.value
         FROM public.database_row row LEFT JOIN public.database_cell cell
           ON cell.database_id = row.database_id AND cell.row_id = row.id
           AND cell.column_id = ANY($2::bigint[])
         WHERE row.database_id = $1 ORDER BY row.id',
        [$databaseId, '{' . implode(',', array_column($plans, 'id')) . '}']);
    if ($existingRows === false) respond(500, ['error' => 'Failed to inspect existing CSV rows']);
    $storedRows = [];
    while (($cell = pg_fetch_assoc($existingRows)) !== false) {
        $storedRows[$cell['row_id']][(string) $cell['column_id']] = $cell['value'];
    }
    $seen = [];
    foreach ($storedRows as $values) {
        $signature = json_encode(array_map(static fn (array $plan): ?string =>
            $values[(string) $plan['id']] ?? null, $plans));
        $seen[$signature] = true;
    }
    $newRows = [];
    $relationIndexes = [];
    foreach ($rows as $index => $csvRow) {
        $values = [];
        foreach ($plans as $plan) {
            $values[] = $plan['relation'] === null
                ? mdbCsvStoredValue($db, $plan['type'], $plan['options'],
                    $csvRow[$plan['index']], $plan['name'], $index + 2)
                : mdbCsvResolveRelation($db, $plan['relation'], $plan['type'],
                    $csvRow[$plan['index']], $plan['name'], $index + 2,
                    $relationIndexes, $relatedRowsAdded, $optionsAdded);
        }
        $signature = json_encode($values);
        if (isset($seen[$signature])) continue;
        $seen[$signature] = true;
        $newRows[] = $values;
    }
    $added = count($newRows);
    if ($added > 0) {
        $maximumResult = @pg_query_params($db,
            'SELECT COALESCE(MAX(position), 0) FROM public.database_row WHERE database_id = $1', [$databaseId]);
        if ($maximumResult === false) respond(500, ['error' => 'Failed to import CSV rows']);
        $maximum = (int) pg_fetch_result($maximumResult, 0, 0);
        if ($maximum > PHP_INT_MAX - $added) respond(409, ['error' => 'No room to add rows']);
        $created = @pg_query_params($db,
            'INSERT INTO public.database_row (database_id, position)
             SELECT $1, $2::bigint + sequence FROM generate_series(1, $3::integer) AS series(sequence)
             RETURNING id, position', [$databaseId, $maximum, $added]);
        if ($created === false) respond(500, ['error' => 'Failed to import CSV rows']);
        $rowIds = [];
        while (($row = pg_fetch_assoc($created)) !== false) {
            $rowIds[(int) $row['position'] - $maximum - 1] = (int) $row['id'];
        }
        if (count($rowIds) !== $added) respond(500, ['error' => 'Failed to import CSV rows']);
        $cells = [];
        foreach ($newRows as $rowIndex => $values) {
            foreach ($values as $columnIndex => $value) {
                if ($value === null) continue;
                $cells[] = ['row_id' => $rowIds[$rowIndex], 'column_id' => $plans[$columnIndex]['id'], 'value' => $value];
                if (count($cells) === 500) { mdbCsvInsertCells($db, $databaseId, $cells); $cells = []; }
            }
        }
        mdbCsvInsertCells($db, $databaseId, $cells);
    }
    if (@pg_query($db, 'COMMIT') === false) respond(500, ['error' => 'Failed to import CSV']);
    respond(200, ['columns_added' => $columnsAdded, 'rows_added' => $added,
        'rows_skipped' => count($rows) - $added, 'options_added' => $optionsAdded,
        'related_rows_added' => $relatedRowsAdded]);
}
