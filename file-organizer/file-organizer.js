#!/usr/bin/env node
import path from 'node:path';
import { Scanner } from './lib/scanner.js';
import { DuplicateFinder } from './lib/duplicates.js';
import { Organizer } from './lib/organizer.js';
import { Cleanup } from './lib/cleanup.js';
import { drawProgressBar, formatSize, handleError, warn } from './lib/utils.js';

const SEPARATOR = '━'.repeat(34);

const USAGE = `Usage:
  node file-organizer.js scan <directory>
  node file-organizer.js duplicates <directory>
  node file-organizer.js organize <directory> --output <target-directory>
  node file-organizer.js cleanup <directory> [--older-than <days>] [--confirm]`;

const [, , command, target, ...args] = process.argv;

function showProgress(label, current, total, suffix = '') {
  const bar = drawProgressBar(current, total);
  const lineEnd = current === total ? '\n' : '';
  process.stdout.write(`\r${label} ${bar}${suffix}${lineEnd}`);
}

function onFileError({ path: filePath, error }) {
  warn(error, filePath);
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function getOptionValue(name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

async function runScan() {
  const scanner = new Scanner();

  scanner.on('scan-start', ({ directory }) => {
    console.log(`📂 Scanning: ${directory}`);
  });

  scanner.on('file-found', ({ current, total }) => {
    showProgress('Processing...', current, total, ' files');
  });

  scanner.on('file-error', onFileError);

  scanner.on('scan-complete', (stats) => {
    console.log(`\n📊 Scan Results:\n${SEPARATOR}`);
    console.log(`Total files: ${stats.totalFiles}`);
    console.log(`Total size: ${formatSize(stats.totalSize)}`);
    if (stats.totalFiles === 0) {
      return;
    }

    console.log();

    console.log('By File Type:');
    const types = [...stats.byType].sort(
      (a, b) => b[1].totalSize - a[1].totalSize,
    );
    for (const [ext, { count, totalSize }] of types) {
      const line = `  ${ext.padEnd(8)}${plural(count, 'file').padStart(9)}`;
      console.log(`${line} ${formatSize(totalSize).padStart(10)}`);
    }

    console.log(`
File Age:
  Last 7 days:    ${plural(stats.age.last7, 'file')}
  Last 30 days:   ${plural(stats.age.last30, 'file')}
  Older than 90:  ${plural(stats.age.over90, 'file')}`);

    console.log('\nLargest files:');
    const names = stats.largest.map((file) => path.basename(file.path));
    const nameWidth = Math.max(0, ...names.map((name) => name.length));
    stats.largest.forEach((file, i) => {
      const name = names[i].padEnd(nameWidth);
      console.log(`  ${i + 1}. ${name}  ${formatSize(file.size)}`);
    });

    if (stats.oldest) {
      const name = path.basename(stats.oldest.path);
      const days = Math.floor(stats.oldest.daysOld);
      console.log(`\nOldest file: ${name} (modified ${days} days ago)`);
    }
  });

  await scanner.scan(target);
}

async function runDuplicates() {
  const finder = new DuplicateFinder();
  const root = path.resolve(target);
  const base = path.dirname(root);

  console.log(`🔍 Searching for duplicates in: ${root}`);

  finder.on('file-processed', ({ current, total }) => {
    showProgress('Calculating hashes...', current, total, ' files');
  });

  finder.on('file-error', onFileError);

  finder.on('duplicates-found', ({ groups, totalWasted }) => {
    if (groups.length === 0) {
      console.log('\n✅ No duplicates found.');
      return;
    }

    console.log(
      `\nFound ${groups.length} duplicate groups (${formatSize(totalWasted)} wasted):\n`,
    );
    groups.forEach((group, i) => {
      console.log(SEPARATOR);
      console.log(
        `Group ${i + 1} (${group.paths.length} copies, ${formatSize(group.size)} each):`,
      );
      console.log(`  SHA-256: ${group.hash.slice(0, 12)}...\n`);
      for (const filePath of group.paths) {
        console.log(`  📄 ${path.relative(base, filePath)}`);
      }
      console.log(`\n  Wasted space: ${formatSize(group.wasted)}\n`);
    });
    console.log(SEPARATOR);
    console.log(`💾 Total wasted space: ${formatSize(totalWasted)}`);
  });

  await finder.find(root);
}

async function runOrganize() {
  const output = getOptionValue('--output');
  if (!output || output.startsWith('--')) {
    console.error('❌ Error: --output <target-directory> is required');
    process.exit(1);
  }

  const organizer = new Organizer();
  const outputName = path.basename(path.resolve(output));

  console.log(`📦 Organizing: ${path.resolve(target)}`);
  console.log(`Target: ${path.resolve(output)}\n`);

  organizer.on('organize-start', ({ folders }) => {
    console.log('Creating folders...');
    for (const folder of folders) {
      console.log(`  ✓ ${folder}/`);
    }
    console.log();
  });

  organizer.on('copy-complete', ({ current, total }) => {
    showProgress('Copying files...', current, total);
  });

  organizer.on('file-error', onFileError);

  organizer.on('copy-error', ({ path: filePath, error, current, total }) => {
    warn(error, filePath);
    showProgress('Copying files...', current, total);
  });

  organizer.on('organize-complete', ({ counts, totalCopied, totalSize }) => {
    console.log('\n✅ Organization complete!\n');
    console.log('Summary:');
    for (const [category, count] of Object.entries(counts)) {
      const name = `${category}:`.padEnd(11);
      console.log(
        `  ${name}${String(count).padStart(4)} files → ${outputName}/${category}/`,
      );
    }
    const size = formatSize(totalSize);
    console.log(`\nTotal copied: ${totalCopied} files (${size})`);
  });

  await organizer.organize(target, output);
}

async function runCleanup() {
  const rawDays = getOptionValue('--older-than') ?? '90';
  const days = Number(rawDays);
  if (Number.isNaN(days) || days <= 0) {
    console.error(`❌ Error: --older-than must be a positive number: ${rawDays}`);
    process.exit(1);
  }
  const confirm = args.includes('--confirm');

  const cleanup = new Cleanup();
  const oldFiles = [];

  console.log(`🧹 Cleanup: ${path.resolve(target)}`);
  console.log(`Looking for files older than ${days} days...\n`);

  cleanup.on('file-found', (file) => oldFiles.push(file));

  cleanup.on('file-error', onFileError);

  cleanup.on('file-deleted', ({ current, total }) => {
    showProgress('Deleting...', current, total);
  });

  cleanup.on('delete-error', ({ path: filePath, error, current, total }) => {
    warn(error, filePath);
    showProgress('Deleting...', current, total);
  });

  cleanup.on('cleanup-complete', ({ deleted, freed, dryRun }) => {
    if (dryRun) {
      console.log('\n⚠️  DRY RUN MODE: No files were deleted.');
      console.log('To actually delete these files, run with --confirm flag.');
      return;
    }
    console.log('\n✅ Cleanup complete!');
    console.log(`Deleted: ${deleted} files (${formatSize(freed)} freed)`);
  });

  await cleanup.find(target, days);

  if (oldFiles.length === 0) {
    console.log(`✅ No files older than ${days} days found.`);
    return;
  }

  const totalSize = oldFiles.reduce((sum, file) => sum + file.size, 0);

  console.log(`Found ${oldFiles.length} files to delete:\n`);
  console.log(SEPARATOR);
  for (const file of oldFiles.slice(0, 3)) {
    const date = file.mtime.toISOString().slice(0, 10);
    console.log(path.basename(file.path));
    console.log(`  Size: ${formatSize(file.size)}`);
    console.log(`  Modified: ${Math.floor(file.daysOld)} days ago (${date})\n`);
  }
  if (oldFiles.length > 3) {
    console.log(`... (${oldFiles.length - 3} more files)`);
  }
  console.log(SEPARATOR);

  if (!confirm) {
    console.log(`\nTotal: ${oldFiles.length} files (${formatSize(totalSize)})`);
  } else {
    console.log(
      `\n⚠️  DELETING ${oldFiles.length} files (${formatSize(totalSize)}). This action cannot be undone!\n`,
    );
  }
  await cleanup.deleteFiles(oldFiles, confirm);
}

const knownCommands = ['scan', 'duplicates', 'organize', 'cleanup'];

if (!knownCommands.includes(command) || !target) {
  console.error(USAGE);
  process.exit(1);
}

try {
  switch (command) {
    case 'scan':
      await runScan();
      break;
    case 'duplicates':
      await runDuplicates();
      break;
    case 'organize':
      await runOrganize();
      break;
    case 'cleanup':
      await runCleanup();
      break;
  }
} catch (error) {
  handleError(error, target);
}
