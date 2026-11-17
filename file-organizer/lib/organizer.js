import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { getAllFiles } from './utils.js';

const TEN_MB = 10 * 1024 * 1024;

const categories = {
  Documents: ['.pdf', '.docx', '.doc', '.txt', '.md', '.xlsx', '.pptx'],
  Images: ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp'],
  Archives: ['.zip', '.rar', '.tar', '.gz', '.7z'],
  Code: ['.js', '.py', '.java', '.cpp', '.html', '.css', '.json'],
  Videos: ['.mp4', '.avi', '.mkv', '.mov', '.webm'],
  Other: [],
};

function getCategory(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  for (const [name, extensions] of Object.entries(categories)) {
    if (extensions.includes(ext)) {
      return name;
    }
  }
  return 'Other';
}

async function exists(filePath) {
  try {
    await fsPromises.access(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function getFreePath(folder, fileName) {
  const ext = path.extname(fileName);
  const base = path.basename(fileName, ext);
  let target = path.join(folder, fileName);

  for (let n = 1; await exists(target); n++) {
    target = path.join(folder, `${base}(${n})${ext}`);
  }
  return target;
}

export class Organizer extends EventEmitter {
  async organize(source, output) {
    const sourceDir = path.resolve(source);
    const outputDir = path.resolve(output);
    const paths = await getAllFiles(sourceDir, (error, filePath) => {
      this.emit('file-error', { path: filePath, error });
    });

    const folders = Object.keys(categories);
    for (const folder of folders) {
      await fsPromises.mkdir(path.join(outputDir, folder), { recursive: true });
    }
    this.emit('organize-start', { folders, total: paths.length });

    const counts = Object.fromEntries(folders.map((folder) => [folder, 0]));
    let totalCopied = 0;
    let totalSize = 0;

    for (let i = 0; i < paths.length; i++) {
      const progress = { current: i + 1, total: paths.length };
      const category = getCategory(paths[i]);

      try {
        const { size } = await fsPromises.stat(paths[i]);
        const target = await getFreePath(
          path.join(outputDir, category),
          path.basename(paths[i]),
        );
        this.emit('copy-start', { source: paths[i], target, category });

        if (size >= TEN_MB) {
          await pipeline(
            fs.createReadStream(paths[i]),
            fs.createWriteStream(target),
          );
        } else {
          await fsPromises.copyFile(paths[i], target);
        }

        counts[category]++;
        totalCopied++;
        totalSize += size;
        const source = paths[i];
        this.emit('copy-complete', { source, target, size, ...progress });
      } catch (error) {
        this.emit('copy-error', { path: paths[i], error, ...progress });
      }
    }

    this.emit('organize-complete', { counts, totalCopied, totalSize });
  }
}
