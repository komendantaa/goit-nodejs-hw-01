# File Organizer

CLI-застосунок на Node.js для наведення порядку в директорії на кшталт `Downloads`:

- **scan** — статистика: кількість файлів, розміри, типи, вік, найбільші та найстаріший файли;
- **duplicates** — пошук файлів з однаковим вмістом за SHA-256;
- **organize** — копіювання файлів по категоріях (`Documents`, `Images`, `Archives`, `Code`, `Videos`, `Other`);
- **cleanup** — пошук (і за бажанням видалення) файлів, старіших за N днів.

## Вимоги та встановлення

Потрібен Node.js 20 або новіший. Залежностей немає, тому `npm install` не потрібен.

```bash
git clone https://github.com/komendantaa/goit-nodejs-hw-01.git
cd goit-nodejs-hw-01/file-organizer
node file-organizer.js scan ~/Downloads
```

## Використання

Кожну команду можна запустити через `node` або через npm-скрипт (аргументи після `--` передаються в застосунок).

### scan

Рекурсивно обходить `<directory>` і виводить звіт.

```bash
node file-organizer.js scan <directory>
npm run scan -- <directory>
```

```
📂 Scanning: /tmp/Downloads
Processing... ████████████████████ 28/28 files

📊 Scan Results:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total files: 28
Total size: 64.2 MB

By File Type:
  .mp4       2 files    24.0 MB
  .pdf       4 files     9.8 MB
  ...

File Age:
  Last 7 days:    20 files
  ...
Oldest file: .hidden (modified 500 days ago)
```

### duplicates

Обчислює SHA-256 кожного файлу через stream і показує групи однакових файлів та марнований обсяг.

```bash
node file-organizer.js duplicates <directory>
npm run duplicates -- <directory>
```

```
Found 5 duplicate groups (21.8 MB wasted):

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Group 2 (3 copies, 3.2 MB each):
  SHA-256: 72a197b27fb1...

  📄 Downloads/backup/lecture_copy.pdf
  📄 Downloads/lecture(1).pdf
  📄 Downloads/lecture.pdf

  Wasted space: 6.4 MB
...
```

### organize

Копіює файли з `<directory>` у `--output` по папках-категоріях, оригінали лишаються на місці. Якщо файл з такою назвою вже є, додається номер: `file.pdf` → `file(1).pdf` → `file(2).pdf`. Файли менші за 10 MB копіюються через `fs.copyFile`, більші — через `pipeline` зі streams.

```bash
node file-organizer.js organize <directory> --output <target-directory>
npm run organize -- <directory> --output <target-directory>
```

- `--output <dir>` — цільова директорія (обов'язково), створюється, якщо її немає.

```
✅ Organization complete!

Summary:
  Documents:   11 files → Organized/Documents/
  ...

Total copied: 28 files (64.2 MB)
```

### cleanup

Шукає файли, остання зміна яких була давніше за вказану кількість днів. Без `--confirm` нічого не видаляє (dry run).

```bash
node file-organizer.js cleanup <directory> --older-than <days> [--confirm]
npm run cleanup -- <directory> --older-than <days> [--confirm]
```

- `--older-than <days>` — вік у днях, додатне число (за замовчуванням 90);
- `--confirm` — фактично видалити знайдені файли.

```
Found 7 files to delete:
...
.hidden
  Size: 3 B
  Modified: 500 days ago (2025-07-05)

... (4 more files)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Total: 7 files (756.8 KB)

⚠️  DRY RUN MODE: No files were deleted.
To actually delete these files, run with --confirm flag.
```

## Структура проєкту

```
file-organizer/
├── package.json         # "type": "module", npm-скрипти
├── .gitignore
├── README.md
├── file-organizer.js    # точка входу: аргументи та вивід у консоль
└── lib/
    ├── scanner.js       # Scanner (scan)
    ├── duplicates.js    # DuplicateFinder (duplicates)
    ├── organizer.js     # Organizer (organize)
    ├── cleanup.js       # Cleanup (cleanup)
    └── utils.js         # formatSize, drawProgressBar, getAllFiles, помилки
```

## Архітектура та помилки

Кожна команда — клас, що наслідує `EventEmitter` і нічого не виводить сам: він лише генерує події (`file-found`, `file-processed`, `copy-complete`, `file-deleted`, `*-complete` тощо). `file-organizer.js` підписується на них і малює прогрес-бар та звіти.

Усі файлові операції обгорнуті в `try...catch`. Помилка на старті (немає директорії, немає доступу) завершує програму через `handleError` з окремими повідомленнями для `ENOENT`, `EACCES` та інших помилок і кодом виходу 1. Помилка на окремому файлі лише виводить `⚠️  Skipped <path>: <reason>`, і обробка триває.
