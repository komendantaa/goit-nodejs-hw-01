import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getAllFiles } from './utils.js';

const DAY_MS = 1000 * 60 * 60 * 24;

export class Scanner extends EventEmitter {
  async scan(directory) {
    const root = path.resolve(directory);
    this.emit('scan-start', { directory: root });

    const onError = (error, filePath) => {
      this.emit('file-error', { path: filePath, error });
    };
    const paths = await getAllFiles(root, onError);

    const files = [];
    const byType = new Map();
    const age = { last7: 0, last30: 0, over90: 0 };
    let totalSize = 0;

    for (let i = 0; i < paths.length; i++) {
      let stats;
      try {
        stats = await fs.stat(paths[i]);
      } catch (error) {
        onError(error, paths[i]);
        continue;
      }

      const daysOld = (Date.now() - stats.mtime.getTime()) / DAY_MS;
      const file = { path: paths[i], size: stats.size, daysOld };
      files.push(file);
      totalSize += stats.size;

      const ext = path.extname(paths[i]).toLowerCase() || '(none)';
      const type = byType.get(ext) ?? { count: 0, totalSize: 0 };
      type.count++;
      type.totalSize += stats.size;
      byType.set(ext, type);

      if (daysOld <= 7) age.last7++;
      if (daysOld <= 30) age.last30++;
      if (daysOld > 90) age.over90++;

      this.emit('file-found', { ...file, current: i + 1, total: paths.length });
    }

    this.emit('scan-complete', {
      totalFiles: files.length,
      totalSize,
      byType,
      age,
      largest: [...files].sort((a, b) => b.size - a.size).slice(0, 3),
      oldest: [...files].sort((a, b) => b.daysOld - a.daysOld)[0],
    });
  }
}
