<?php
declare(strict_types=1);

return static function (): void {
    [$db, $error] = openMdbDb();
    if ($db === false) respond(503, ['status' => 'unavailable', 'error' => $error]);
    if (@pg_query($db,
        'SELECT u.id, u.auth_user_id, d.id, d.user_id, d.name, d.created,
                c.id, c.database_id, c.name, c.position, c.width, c.type, c.options, c.relation_database_id, c.relation_display_column_id,
                r.id, r.database_id, r.position,
                v.row_id, v.column_id, v.value,
                s.id, s.database_id, s.status, sc.suggestion_id, sc.proposed_value
         FROM public."user" u, public.user_database d,
              public.database_column c, public.database_row r, public.database_cell v,
              public.cell_suggestion s, public.cell_suggestion_change sc,
              public.row_delete_suggestion rd, public.row_create_suggestion rc LIMIT 0') === false) {
        respond(503, ['status' => 'unavailable', 'error' => 'MDB database schema is not ready']);
    }
};
