import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { getAllFiles } from './utils.js';

function calculateHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);

    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

export class DuplicateFinder extends EventEmitter {
  async find(directory) {
    const root = path.resolve(directory);
    const onError = (error, filePath) => {
      this.emit('file-error', { path: filePath, error });
    };
    const paths = await getAllFiles(root, onError);

    const hashes = new Map();
    const sizes = new Map();

    for (let i = 0; i < paths.length; i++) {
      try {
        const hash = await calculateHash(paths[i]);
        const stats = await fsPromises.stat(paths[i]);
        hashes.set(hash, [...(hashes.get(hash) ?? []), paths[i]]);
        sizes.set(hash, stats.size);
      } catch (error) {
        onError(error, paths[i]);
      }
      this.emit('file-processed', { current: i + 1, total: paths.length });
    }

    const groups = [];
    let totalWasted = 0;
    for (const [hash, filePaths] of hashes) {
      if (filePaths.length > 1) {
        const size = sizes.get(hash);
        const wasted = size * (filePaths.length - 1);
        groups.push({ hash, paths: filePaths, size, wasted });
        totalWasted += wasted;
      }
    }
    groups.sort((a, b) => b.wasted - a.wasted);

    this.emit('duplicates-found', { groups, totalWasted });
  }
}
