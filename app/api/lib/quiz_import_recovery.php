<?php
declare(strict_types=1);

function recoverQuizImportBatch($quizDb, $mediaDb, string $batchId): bool
{
    $mediaOpen = false;
    $quizOpen = false;
    try {
        if (@pg_query($mediaDb, 'BEGIN') === false) return false;
        $mediaOpen = true;
        $batchResult = @pg_query_params($mediaDb,
            'SELECT owner_auth_user_id, quiz_id, image_ids
             FROM public.quiz_import_recovery WHERE id = $1 FOR UPDATE', [$batchId]);
        if ($batchResult === false) return false;
        $batch = pg_fetch_assoc($batchResult);
        if ($batch === false) {
            if (@pg_query($mediaDb, 'COMMIT') === false) return false;
            $mediaOpen = false;
            return true;
        }
        $ownerId = (int) $batch['owner_auth_user_id'];
        if (@pg_query($quizDb, 'BEGIN') === false) return false;
        $quizOpen = true;
        if (@pg_query_params($quizDb, 'SELECT pg_advisory_xact_lock($1)', [$ownerId]) === false
            || @pg_query_params($mediaDb, 'SELECT pg_advisory_xact_lock($1)', [$ownerId]) === false) return false;

        $exists = @pg_query_params($quizDb,
            'SELECT 1 FROM public.quiz_import_receipt
             WHERE id = $1 AND quiz_id = $2 AND owner_auth_user_id = $3',
            [$batchId, $batch['quiz_id'], $ownerId]);
        if ($exists === false) return false;
        $quizCommitted = pg_num_rows($exists) !== 0;
        if (!$quizCommitted) {
            $imageIds = json_decode($batch['image_ids'], true, 512, JSON_THROW_ON_ERROR);
            foreach ($imageIds as $imageId) {
                $used = @pg_query_params($quizDb,
                    'SELECT EXISTS (
                        SELECT 1 FROM public.question WHERE jsonb_path_exists(config, $1::jsonpath,
                            jsonb_build_object(\'id\', $2::bigint))
                     ) OR EXISTS (
                        SELECT 1 FROM public.quiz_attempt_source WHERE jsonb_path_exists(config, $1::jsonpath,
                            jsonb_build_object(\'id\', $2::bigint))
                     ) AS used', [QUIZ_IMAGE_REFERENCE_PATH, $imageId]);
                if ($used === false) return false;
                if (pg_fetch_result($used, 0, 'used') === 't') continue;
                $deleted = @pg_query_params($mediaDb,
                    'DELETE FROM public.image WHERE id = $1 AND owner_auth_user_id = $2 AND shared = FALSE
                     RETURNING blob_id', [$imageId, $ownerId]);
                if ($deleted === false) return false;
                $row = pg_fetch_assoc($deleted);
                if ($row !== false && @pg_query_params($mediaDb,
                    'DELETE FROM public.image_blob b WHERE b.id = $1
                     AND NOT EXISTS (SELECT 1 FROM public.image i WHERE i.blob_id = b.id)',
                    [$row['blob_id']]) === false) return false;
            }
        }
        if (@pg_query_params($mediaDb,
            'DELETE FROM public.quiz_import_recovery WHERE id = $1', [$batchId]) === false) return false;
        if (@pg_query($mediaDb, 'COMMIT') === false) return false;
        $mediaOpen = false;
        if ($quizCommitted && @pg_query_params($quizDb,
            'DELETE FROM public.quiz_import_receipt WHERE id = $1', [$batchId]) === false) return false;
        if (@pg_query($quizDb, 'COMMIT') === false) return false;
        $quizOpen = false;
        return true;
    } finally {
        if ($mediaOpen) @pg_query($mediaDb, 'ROLLBACK');
        if ($quizOpen) @pg_query($quizDb, 'ROLLBACK');
    }
}
