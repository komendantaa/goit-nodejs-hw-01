import fs from 'node:fs/promises';
import path from 'node:path';

export function formatSize(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  } else if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  } else if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  } else {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
}

export function drawProgressBar(current, total, width = 20) {
  const percentage = total === 0 ? 1 : current / total;
  const filled = Math.round(percentage * width);
  const bar = '█'.repeat(filled) + '░'.repeat(width - filled);
  return `${bar} ${current}/${total}`;
}

// Returns absolute paths of all regular files. An unreadable subdirectory is
// reported through onError and skipped; an unreadable root directory throws.
export async function getAllFiles(dir, onError) {
  const files = [];

  async function walk(current) {
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch (error) {
      if (current === dir) {
        throw error;
      }
      onError(error, current);
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }

  await walk(dir);
  return files;
}

export function handleError(error, targetPath) {
  if (error.code === 'ENOENT') {
    console.error(`❌ Error: Directory not found: ${targetPath}`);
  } else if (error.code === 'EACCES') {
    console.error(`❌ Error: Permission denied: ${error.path ?? targetPath}`);
  } else if (error.code === 'ENOTDIR') {
    console.error(`❌ Error: Not a directory: ${error.path ?? targetPath}`);
  } else {
    console.error(`❌ Unexpected error: ${error.message}`);
  }
  process.exit(1);
}

export function warn(error, filePath) {
  let reason = error.message;
  if (error.code === 'ENOENT') {
    reason = 'file not found';
  } else if (error.code === 'EACCES') {
    reason = 'permission denied';
  }
  console.warn(`\n⚠️  Skipped ${filePath}: ${reason}`);
}
