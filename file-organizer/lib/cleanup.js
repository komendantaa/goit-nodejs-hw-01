import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getAllFiles } from './utils.js';

export class Cleanup extends EventEmitter {
  async find(directory, threshold) {
    const root = path.resolve(directory);
    const onError = (error, filePath) => {
      this.emit('file-error', { path: filePath, error });
    };
    const paths = await getAllFiles(root, onError);

    for (const filePath of paths) {
      let stats;
      try {
        stats = await fs.stat(filePath);
      } catch (error) {
        onError(error, filePath);
        continue;
      }

      const fileAge = Date.now() - stats.mtime.getTime();
      const daysOld = fileAge / (1000 * 60 * 60 * 24);

      if (daysOld > threshold) {
        this.emit('file-found', {
          path: filePath,
          size: stats.size,
          mtime: stats.mtime,
          daysOld,
        });
      }
    }
  }

  async deleteFiles(files, confirm) {
    if (!confirm) {
      this.emit('cleanup-complete', { deleted: 0, freed: 0, dryRun: true });
      return;
    }

    let deleted = 0;
    let freed = 0;

    for (let i = 0; i < files.length; i++) {
      const progress = { current: i + 1, total: files.length };
      try {
        await fs.unlink(files[i].path);
      } catch (error) {
        this.emit('delete-error', { path: files[i].path, error, ...progress });
        continue;
      }

      deleted++;
      freed += files[i].size;
      this.emit('file-deleted', { path: files[i].path, ...progress });
    }

    this.emit('cleanup-complete', { deleted, freed, dryRun: false });
  }
}
