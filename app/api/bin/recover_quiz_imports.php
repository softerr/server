<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli') exit(1);

require_once __DIR__ . '/../lib/db.php';
require_once __DIR__ . '/../handlers/images.php';
require_once __DIR__ . '/../lib/quiz_import_recovery.php';

[$quizDb] = openQuizDb(5);
[$mediaDb] = openMediaDb(5);
if ($quizDb === false || $mediaDb === false) {
    fwrite(STDERR, "Quiz import recovery could not connect to PostgreSQL.\n");
    exit(1);
}

// Leave active requests alone. A committed batch remains until its quiz
// commit receipt is confirmed or its newly created images are removed.
$result = @pg_query($mediaDb,
    "SELECT id FROM public.quiz_import_recovery
     WHERE created < CURRENT_TIMESTAMP - INTERVAL '5 minutes'
     ORDER BY created, id LIMIT 20");
if ($result === false) {
    fwrite(STDERR, "Quiz import recovery could not load pending batches.\n");
    exit(1);
}
while ($row = pg_fetch_assoc($result)) {
    if (!recoverQuizImportBatch($quizDb, $mediaDb, trim($row['id']))) {
        fwrite(STDERR, "Quiz import recovery failed for batch {$row['id']}.\n");
        exit(1);
    }
}

// A request may stop after clearing the media record but before clearing its
// quiz receipt. The media-first commit order makes such receipts safe to prune.
$receipts = @pg_query($quizDb,
    "SELECT id FROM public.quiz_import_receipt
     WHERE created < CURRENT_TIMESTAMP - INTERVAL '5 minutes'
     ORDER BY created, id LIMIT 20");
if ($receipts === false) {
    fwrite(STDERR, "Quiz import recovery could not load old receipts.\n");
    exit(1);
}
while ($row = pg_fetch_assoc($receipts)) {
    $batchId = trim($row['id']);
    $pending = @pg_query_params($mediaDb,
        'SELECT 1 FROM public.quiz_import_recovery WHERE id = $1', [$batchId]);
    if ($pending === false) {
        fwrite(STDERR, "Quiz import recovery could not check receipt {$batchId}.\n");
        exit(1);
    }
    if (pg_num_rows($pending) === 0 && @pg_query_params($quizDb,
        'DELETE FROM public.quiz_import_receipt WHERE id = $1', [$batchId]) === false) {
        fwrite(STDERR, "Quiz import recovery could not clear receipt {$batchId}.\n");
        exit(1);
    }
}
