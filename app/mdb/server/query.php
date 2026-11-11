<?php
declare(strict_types=1);

function mdbTableQuery(): array
{
    $requestedLimit = $_GET['limit'] ?? '50';
    $limit = $requestedLimit === 'all' ? null : filter_var($requestedLimit, FILTER_VALIDATE_INT,
        ['options' => ['min_range' => 1, 'max_range' => 200]]);
    $offset = filter_var($_GET['offset'] ?? '0', FILTER_VALIDATE_INT,
        ['options' => ['min_range' => 0]]);
    $query = $_GET['q'] ?? '';
    $sortId = filter_var($_GET['sort_column_id'] ?? '0', FILTER_VALIDATE_INT,
        ['options' => ['min_range' => 0]]);
    $direction = $_GET['direction'] ?? 'asc';
    if ($limit === false || ($limit === null && $offset !== 0)
        || $offset === false || $sortId === false || !is_string($query)
        || strlen($query) > 200 || !in_array($direction, ['asc', 'desc'], true)
        || preg_match('//u', $query) !== 1) {
        respond(400, ['error' => 'Invalid table query']);
    }
    return [$limit, $offset, trim($query), $sortId, $direction];
}

function mdbQueryRows($db, int $databaseId, string $query, int $sortId, string $direction,
    ?int $limit, int $offset): array
{
    $sort = null;
    if ($sortId > 0) {
        $result = @pg_query_params($db,
            'SELECT type FROM public.database_column WHERE database_id = $1 AND id = $2',
            [$databaseId, $sortId]);
        if ($result === false) respond(500, ['error' => 'Failed to check sort column']);
        $sort = pg_fetch_assoc($result);
        if ($sort === false) respond(400, ['error' => 'Invalid sort column']);
    }
    $params = [$databaseId, $query, $sortId, $limit, $offset];
    $order = 'r.position ASC';
    $join = '';
    if ($sort !== null) {
        $join = 'LEFT JOIN public.database_cell sv ON sv.database_id = r.database_id
            AND sv.row_id = r.id AND sv.column_id = $3';
        $sortValue = match ($sort['type']) {
            'number' => "NULLIF(sv.value, '')::numeric",
            'checkbox' => "CASE WHEN sv.value = 'true' THEN 1 ELSE 0 END",
            default => "lower(public.mdb_visible_cell_label(sc.type, sv.value,
                sc.relation_database_id, sc.relation_display_column_id))",
        };
        $join .= ' JOIN public.database_column sc ON sc.id = $3';
        $order = "{$sortValue} {$direction} NULLS LAST, r.position ASC";
    }
    if ($query === '') {
        $count = @pg_query_params($db,
            'SELECT COUNT(*) FROM public.database_row WHERE database_id = $1', [$databaseId]);
        if ($count === false) respond(500, ['error' => 'Failed to count database rows']);
        $total = (int) pg_fetch_result($count, 0, 0);
        $page = @pg_query_params($db,
            "SELECT r.id, r.position FROM public.database_row r {$join}
             WHERE r.database_id = $1 AND $2::text IS NOT NULL AND $3::bigint >= 0
             ORDER BY {$order} LIMIT $4 OFFSET $5", $params);
    } else {
        // Resolve labels on related rows once, then match the stored relation IDs.
        // The old correlated search rebuilt each label for every source row and cell.
        $page = @pg_query_params($db,
            "WITH related_hits AS MATERIALIZED (
                SELECT c.id AS column_id, target.id AS target_id
                FROM public.database_column c
                JOIN public.database_row target ON target.database_id = c.relation_database_id
                LEFT JOIN public.database_column display ON display.id = c.relation_display_column_id
                LEFT JOIN public.database_cell shown ON shown.row_id = target.id
                    AND shown.column_id = display.id
                WHERE c.database_id = $1 AND c.type IN ('relation', 'multi_relation')
                  AND strpos(lower(CASE WHEN display.id IS NOT NULL
                      THEN COALESCE(public.mdb_plain_cell_label(display.type, shown.value), '—')
                      ELSE public.mdb_row_label(target.database_id, target.id, NULL)
                  END), lower($2)) > 0
            ), matched AS MATERIALIZED (
                SELECT cell.row_id
                FROM public.database_cell cell
                JOIN public.database_column c ON c.id = cell.column_id
                WHERE cell.database_id = $1 AND c.type NOT IN ('relation', 'multi_relation')
                  AND strpos(lower(COALESCE(public.mdb_plain_cell_label(c.type, cell.value), '')),
                      lower($2)) > 0
                UNION
                SELECT r.id
                FROM public.database_row r
                JOIN public.database_column c ON c.database_id = r.database_id AND c.type = 'checkbox'
                LEFT JOIN public.database_cell cell ON cell.row_id = r.id AND cell.column_id = c.id
                WHERE r.database_id = $1 AND cell.row_id IS NULL
                  AND strpos('no', lower($2)) > 0
                UNION
                SELECT cell.row_id
                FROM public.database_column c
                JOIN public.database_cell cell ON cell.database_id = c.database_id
                    AND cell.column_id = c.id
                CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN c.type = 'multi_relation'
                    THEN cell.value::jsonb ELSE jsonb_build_array(cell.value) END) AS ref(id)
                JOIN related_hits hit ON hit.column_id = c.id AND hit.target_id = ref.id::bigint
                WHERE c.database_id = $1 AND c.type IN ('relation', 'multi_relation')
                UNION
                SELECT cell.row_id
                FROM public.database_column c
                JOIN public.database_cell cell ON cell.database_id = c.database_id
                    AND cell.column_id = c.id
                WHERE c.database_id = $1 AND c.type = 'multi_relation'
                  AND strpos($2, ',') > 0
                  AND strpos(lower(COALESCE(public.mdb_visible_cell_label(c.type, cell.value,
                      c.relation_database_id, c.relation_display_column_id), '')), lower($2)) > 0
            )
            SELECT page.id, page.position, totals.total
            FROM (SELECT COUNT(*) AS total FROM matched) totals
            LEFT JOIN (
                SELECT r.id, r.position FROM matched match
                JOIN public.database_row r ON r.id = match.row_id AND r.database_id = $1
                {$join}
                WHERE $3::bigint >= 0
                ORDER BY {$order} LIMIT $4 OFFSET $5
            ) page ON true", $params);
    }
    if ($page === false) respond(500, ['error' => 'Failed to load database rows']);
    $ids = [];
    $positions = [];
    while (($row = pg_fetch_assoc($page)) !== false) {
        if ($query !== '') $total = (int) $row['total'];
        if ($row['id'] === null) continue;
        $id = (int) $row['id'];
        $ids[] = $id;
        $positions[$id] = (int) $row['position'];
    }
    return [$ids, $positions, $total];
}

function mdbRowsWithValues($db, int $databaseId, array $ids, array $positions,
    array $columnTypes): array
{
    if ($ids === []) return [];
    $result = @pg_query_params($db,
        'SELECT row_id, column_id, value FROM public.database_cell
         WHERE database_id = $1 AND row_id = ANY($2::bigint[])',
        [$databaseId, '{' . implode(',', $ids) . '}']);
    if ($result === false) respond(500, ['error' => 'Failed to load database cells']);
    $rows = [];
    foreach ($ids as $id) $rows[$id] = ['id' => $id, 'position' => $positions[$id], 'values' => []];
    while (($cell = pg_fetch_assoc($result)) !== false) {
        $rows[(int) $cell['row_id']]['values'][(string) $cell['column_id']] =
            mdbPublicCellValue($columnTypes[$cell['column_id']] ?? 'text', $cell['value']);
    }
    foreach ($rows as &$row) $row['values'] = (object) $row['values'];
    unset($row);
    return array_values($rows);
}

function handleQueryMdbDatabase(array $user, int $databaseId): never
{
    [$limit, $offset, $query, $sortId, $direction] = mdbTableQuery();
    $db = connectAppDb('mdb');
    $database = mdbOwnedDatabase($db, (int) $user['id'], $databaseId);
    $columnsResult = @pg_query_params($db,
        'SELECT id, name, position, width, type, options, relation_database_id,
            relation_display_column_id FROM public.database_column
         WHERE database_id = $1 ORDER BY position', [$databaseId]);
    if ($columnsResult === false) respond(500, ['error' => 'Failed to load database columns']);
    $columns = [];
    $types = [];
    while (($column = pg_fetch_assoc($columnsResult)) !== false) {
        $columns[] = publicMdbColumn($column);
        $types[$column['id']] = $column['type'];
    }
    [$ids, $positions, $total] = mdbQueryRows($db, $databaseId, $query, $sortId,
        $direction, $limit, $offset);
    respond(200, ['database' => publicMdbDatabase($database), 'columns' => $columns,
        'rows' => mdbRowsWithValues($db, $databaseId, $ids, $positions, $types),
        'total_rows' => $total, 'next_offset' => $offset + count($ids) < $total
            ? $offset + count($ids) : null]);
}

function handleMdbChoices(array $user, int $databaseId): never
{
    $db = connectAppDb('mdb');
    mdbOwnedDatabase($db, (int) $user['id'], $databaseId);
    $displayId = filter_var($_GET['display_column_id'] ?? '0', FILTER_VALIDATE_INT,
        ['options' => ['min_range' => 0]]);
    if ($displayId === false) respond(400, ['error' => 'Invalid display column']);
    if ($displayId > 0) {
        $column = @pg_query_params($db,
            'SELECT 1 FROM public.database_column WHERE database_id = $1 AND id = $2',
            [$databaseId, $displayId]);
        if ($column === false || pg_num_rows($column) !== 1) respond(400, ['error' => 'Invalid display column']);
    }
    $idsText = $_GET['ids'] ?? null;
    if ($idsText !== null) {
        if (!is_string($idsText) || strlen($idsText) > 4000
            || preg_match('/^[1-9][0-9]*(,[1-9][0-9]*)*$/D', $idsText) !== 1) {
            respond(400, ['error' => 'Invalid row IDs']);
        }
        $ids = array_unique(explode(',', $idsText));
        if (count($ids) > 200) respond(400, ['error' => 'Too many row IDs']);
        foreach ($ids as $id) {
            if (filter_var($id, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]) === false) {
                respond(400, ['error' => 'Invalid row IDs']);
            }
        }
        $where = 'r.id = ANY($3::bigint[])';
        $params = [$databaseId, $displayId ?: null, '{' . implode(',', $ids) . '}'];
        $page = @pg_query_params($db,
            "SELECT r.id, public.mdb_row_label($1, r.id, $2) AS label
             FROM public.database_row r WHERE r.database_id = $1 AND {$where}", $params);
        if ($page === false) respond(500, ['error' => 'Failed to load related rows']);
        $choices = [];
        while (($row = pg_fetch_assoc($page)) !== false) {
            $choices[] = ['id' => (int) $row['id'], 'label' => $row['label']];
        }
        respond(200, ['choices' => $choices, 'next_offset' => null]);
    }
    $limit = filter_var($_GET['limit'] ?? '50', FILTER_VALIDATE_INT,
        ['options' => ['min_range' => 1, 'max_range' => 200]]);
    $offset = filter_var($_GET['offset'] ?? '0', FILTER_VALIDATE_INT,
        ['options' => ['min_range' => 0]]);
    $query = $_GET['q'] ?? '';
    if ($limit === false || $offset === false || !is_string($query) || strlen($query) > 200
        || preg_match('//u', $query) !== 1) respond(400, ['error' => 'Invalid related row query']);
    $params = [$databaseId, $displayId ?: null, trim($query), $limit, $offset];
    if ($params[2] === '') {
        $count = @pg_query_params($db,
            'SELECT COUNT(*) FROM public.database_row WHERE database_id = $1', [$databaseId]);
        $page = @pg_query_params($db,
            'SELECT r.id, public.mdb_row_label($1, r.id, $2) AS label
             FROM public.database_row r WHERE r.database_id = $1 AND $3::text IS NOT NULL
             ORDER BY r.position LIMIT $4 OFFSET $5', $params);
        if ($count === false || $page === false) respond(500, ['error' => 'Failed to load related rows']);
        $total = (int) pg_fetch_result($count, 0, 0);
    } else {
        $page = @pg_query_params($db,
            "WITH labels AS MATERIALIZED (
                SELECT r.id, r.position, CASE WHEN $2::bigint IS NULL
                    THEN public.mdb_row_label($1, r.id, NULL)
                    ELSE COALESCE(public.mdb_plain_cell_label(display.type, cell.value), '—')
                END AS label
                FROM public.database_row r
                LEFT JOIN public.database_column display ON display.id = $2
                LEFT JOIN public.database_cell cell ON cell.row_id = r.id
                    AND cell.column_id = display.id
                WHERE r.database_id = $1
            ), matched AS MATERIALIZED (
                SELECT id, position, label FROM labels
                WHERE strpos(lower(label), lower($3)) > 0
            )
            SELECT page.id, page.label, totals.total
            FROM (SELECT COUNT(*) AS total FROM matched) totals
            LEFT JOIN (SELECT id, label FROM matched ORDER BY position LIMIT $4 OFFSET $5) page ON true",
            $params);
        if ($page === false) respond(500, ['error' => 'Failed to load related rows']);
    }
    $choices = [];
    while (($row = pg_fetch_assoc($page)) !== false) {
        if ($params[2] !== '') $total = (int) $row['total'];
        if ($row['id'] === null) continue;
        $choices[] = ['id' => (int) $row['id'], 'label' => $row['label']];
    }
    respond(200, ['choices' => $choices, 'total_rows' => $total,
        'next_offset' => $offset + count($choices) < $total ? $offset + count($choices) : null]);
}

function handleExportMdbCsv(array $user, int $databaseId): never
{
    [, , $query, $sortId, $direction] = mdbTableQuery();
    $db = connectAppDb('mdb');
    if (@pg_query($db, 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY') === false) {
        respond(500, ['error' => 'Failed to start CSV export']);
    }
    $database = mdbOwnedDatabase($db, (int) $user['id'], $databaseId);
    $columnsResult = @pg_query_params($db,
        'SELECT id, name, type, relation_database_id, relation_display_column_id
         FROM public.database_column WHERE database_id = $1 ORDER BY position', [$databaseId]);
    if ($columnsResult === false) respond(500, ['error' => 'Failed to load database columns']);
    $columns = pg_fetch_all($columnsResult) ?: [];
    if ($columns === []) respond(400, ['error' => 'Add a column before exporting CSV']);
    $types = array_column($columns, 'type', 'id');
    $name = preg_replace('/[<>:"\/\\|?*\x00-\x1f]/', '_', $database['name']) ?: 'database';
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="' . $name . '.csv"');
    $out = fopen('php://output', 'wb');
    fwrite($out, "\xEF\xBB\xBF");
    fputcsv($out, array_column($columns, 'name'), ',', '"', '', "\r\n");
    $offset = 0;
    do {
        [$ids, $positions, $total] = mdbQueryRows($db, $databaseId, $query, $sortId,
            $direction, 200, $offset);
        $rows = mdbRowsWithValues($db, $databaseId, $ids, $positions, $types);
        $relationLabels = [];
        foreach ($columns as $column) {
            if ($column['relation_database_id'] === null
                || !in_array($column['type'], ['relation', 'multi_relation'], true)) continue;
            $relatedIds = [];
            foreach ($rows as $row) {
                $value = $row['values']->{$column['id']} ?? null;
                foreach (is_array($value) ? $value : ($value === null ? [] : [$value]) as $id) {
                    $relatedIds[$id] = $id;
                }
            }
            $relationLabels[$column['id']] = [];
            if ($relatedIds === []) continue;
            $labels = @pg_query_params($db,
                'SELECT r.id, public.mdb_row_label($1, r.id, $2) AS label
                 FROM public.database_row r WHERE r.database_id = $1 AND r.id = ANY($3::bigint[])',
                [$column['relation_database_id'], $column['relation_display_column_id'],
                    '{' . implode(',', $relatedIds) . '}']);
            if ($labels === false) respond(500, ['error' => 'Failed to load related row labels']);
            while (($label = pg_fetch_assoc($labels)) !== false) {
                $relationLabels[$column['id']][(int) $label['id']] = $label['label'];
            }
        }
        foreach ($rows as $row) {
            $values = [];
            foreach ($columns as $column) {
                $value = $row['values']->{$column['id']} ?? null;
                if ($value === null) { $values[] = ''; continue; }
                if ($column['type'] === 'checkbox') { $values[] = $value ? 'true' : 'false'; continue; }
                $related = $column['relation_database_id'];
                if ($related !== null && in_array($column['type'], ['relation', 'multi_relation'], true)) {
                    $valueIds = is_array($value) ? $value : [$value];
                    $labels = [];
                    foreach ($valueIds as $id) {
                        $labels[] = $relationLabels[$column['id']][$id] ?? "Missing row {$id}";
                    }
                    $values[] = implode(', ', $labels);
                } else {
                    $values[] = is_array($value) ? implode(', ', $value) : $value;
                }
            }
            fputcsv($out, $values, ',', '"', '', "\r\n");
        }
        $offset += count($ids);
    } while ($offset < $total && $ids !== []);
    fclose($out);
    @pg_query($db, 'COMMIT');
    exit;
}
