<?php
declare(strict_types=1);

// The backup artifacts are already compressed dumps or a TAR. Store them in
// the ZIP without recompression and use ZIP64 for files and offsets over 4 GiB.
final class BackupZipStream
{
    private int $offset = 0;
    private array $entries = [];

    public function __construct(private $output)
    {
        if (!is_resource($output)) throw new InvalidArgumentException('Invalid ZIP output stream');
    }

    public static function expectedLength(array $entries): int
    {
        $length = 98; // ZIP64 end record, locator, and classic end record.
        foreach ($entries as $name => $size) {
            $overhead = 148 + 2 * strlen($name);
            if (!is_int($size) || $size < 0 || $size > PHP_INT_MAX - $length - $overhead) {
                throw new OverflowException('Backup ZIP is too large');
            }
            $length += $size + $overhead;
        }
        return $length;
    }

    private function write(string $bytes): void
    {
        $length = strlen($bytes);
        for ($sent = 0; $sent < $length; $sent += $written) {
            $written = @fwrite($this->output, substr($bytes, $sent));
            if ($written === false || $written === 0) {
                throw new RuntimeException('Backup ZIP output failed');
            }
        }
        $this->offset += $length;
    }

    public function addFile(string $path, string $name, int $size): void
    {
        if ($size < 0 || strlen($name) > 65535) throw new InvalidArgumentException('Invalid ZIP entry');
        $source = @fopen($path, 'rb');
        if ($source === false) throw new RuntimeException('Backup archive could not be opened');
        try {
            $stat = fstat($source);
            if ($stat === false || $stat['size'] !== $size) {
                throw new RuntimeException('Backup archive size changed');
            }
            $start = $this->offset;
            $nameLength = strlen($name);
            $this->write(pack('V', 0x04034b50) . pack('v5', 45, 8, 0, 0, 33)
                . pack('V3', 0, 0xffffffff, 0xffffffff) . pack('v2', $nameLength, 20)
                . $name . pack('v2', 1, 16) . pack('P2', $size, $size));
            $checksum = hash_init('crc32b');
            $remaining = $size;
            while ($remaining > 0) {
                $chunk = fread($source, min($remaining, 1024 * 1024));
                if ($chunk === false || $chunk === '') {
                    throw new RuntimeException('Backup archive could not be read');
                }
                hash_update($checksum, $chunk);
                $this->write($chunk);
                if (!@fflush($this->output)) throw new RuntimeException('Backup ZIP output failed');
                flush();
                $remaining -= strlen($chunk);
                if (connection_aborted()) throw new RuntimeException('Backup download was interrupted');
            }
            $crc = hexdec(hash_final($checksum));
            $this->write(pack('V2', 0x08074b50, $crc) . pack('P2', $size, $size));
            $this->entries[] = ['name' => $name, 'size' => $size, 'crc' => $crc, 'offset' => $start];
        } finally {
            fclose($source);
        }
    }

    public function finish(): void
    {
        $centralOffset = $this->offset;
        foreach ($this->entries as $entry) {
            $name = $entry['name'];
            $size = $entry['size'];
            $this->write(pack('V', 0x02014b50) . pack('v6', 45, 45, 8, 0, 0, 33)
                . pack('V3', $entry['crc'], 0xffffffff, 0xffffffff)
                . pack('v5', strlen($name), 28, 0, 0, 0)
                . pack('V2', 0, 0xffffffff) . $name
                . pack('v2', 1, 24) . pack('P3', $size, $size, $entry['offset']));
        }
        $centralSize = $this->offset - $centralOffset;
        $endOffset = $this->offset;
        $count = count($this->entries);
        $this->write(pack('V', 0x06064b50) . pack('P', 44) . pack('v2', 45, 45)
            . pack('V2', 0, 0) . pack('P4', $count, $count, $centralSize, $centralOffset));
        $this->write(pack('V2', 0x07064b50, 0) . pack('P', $endOffset) . pack('V', 1));
        $this->write(pack('V', 0x06054b50) . pack('v4', 0, 0, 0xffff, 0xffff)
            . pack('V2', 0xffffffff, 0xffffffff) . pack('v', 0));
    }
}
