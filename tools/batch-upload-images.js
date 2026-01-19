#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { HuijiWiki } = require('huijiwiki-api');
const { ProgressTracker, UploadLog } = require('../lib/progress-tracker');
const {
  collectImages,
  transformPath,
  processUploadQueue
} = require('../lib/image-uploader');

function parseArgs(args) {
  const options = {
    source: null,
    config: './config/upload.config.json',
    progressFile: './upload-progress.json',
    logFile: './logs/upload.log',
    resume: null,
    retryFailed: null,
    dryRun: false,
    concurrency: null,
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    switch (arg) {
      case '-s':
      case '--source':
        options.source = next;
        i++;
        break;
      case '-c':
      case '--config':
        options.config = next;
        i++;
        break;
      case '--progress-file':
        options.progressFile = next;
        i++;
        break;
      case '--log-file':
        options.logFile = next;
        i++;
        break;
      case '--resume':
        options.resume = next;
        i++;
        break;
      case '--retry-failed':
        options.retryFailed = next;
        i++;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--concurrency':
        {
          const parsed = Number.parseInt(next, 10);
          options.concurrency = Number.isFinite(parsed) ? parsed : null;
        }
        i++;
        break;
      case '-h':
      case '--help':
        options.help = true;
        break;
    }
  }

  return options;
}

function normalizeConcurrency(value) {
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : null;
}

function resolveConcurrency(requestedConcurrency, config) {
  const normalizedRequested = normalizeConcurrency(requestedConcurrency);
  const configMax = normalizeConcurrency(
    config?.upload?.maxConcurrency ?? config?.upload?.concurrency
  );

  if (normalizedRequested) {
    return configMax ? Math.min(normalizedRequested, configMax) : normalizedRequested;
  }

  return configMax ?? 1;
}

function printHelp() {
  console.log(`
Batch Upload Images to HuijiWiki

Usage:
  node tools/batch-upload-images.js [options]

Options:
  -s, --source <dir>        Source directory containing images (required for new task)
  -c, --config <file>       Config file path (default: ./config/upload.config.json)
  --progress-file <file>    Progress file path (default: ./upload-progress.json)
  --log-file <file>         Upload log file path (default: ./logs/upload.log)
  --resume <file>           Resume from a progress file
  --retry-failed <file>     Retry only failed files from a progress file
  --dry-run                 Preview without uploading
  --concurrency <n>         Number of concurrent uploads (default: config upload.maxConcurrency or 1)
  -h, --help                Show this help message

Examples:
  # New upload task
  node tools/batch-upload-images.js -s ./images -c ./config/upload.config.json

  # Dry run to preview
  node tools/batch-upload-images.js -s ./images --dry-run

  # Resume interrupted task
  node tools/batch-upload-images.js --resume ./upload-progress.json

  # Retry failed uploads
  node tools/batch-upload-images.js --retry-failed ./upload-progress.json
`);
}

function loadConfig(configPath) {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }
  const content = fs.readFileSync(configPath, 'utf-8');
  return JSON.parse(content);
}

function printProgress(event) {
  const now = new Date().toLocaleTimeString();
  switch (event.type) {
    case 'uploading':
      console.log(`[${now}] Uploading: ${event.file}`);
      break;
    case 'success':
      console.log(`[${now}] ✓ Success: ${event.file}`);
      break;
    case 'warning':
      console.log(`[${now}] ⚠ Warning: ${event.file} - ${event.message}`);
      break;
    case 'skip':
      console.log(`[${now}] ○ Skipped: ${event.file} (${event.reason})`);
      break;
    case 'error':
      console.log(`[${now}] ✗ Failed: ${event.file} - ${event.message}`);
      break;
    case 'dry-run':
      console.log(`[${now}] [DRY-RUN] ${event.file}`);
      console.log(`          -> ${event.sanitizedName}`);
      console.log(`          FilePage: ${event.filePageTitle}`);
      console.log(`          Categories: ${JSON.stringify(event.categories)}`);
      console.log(`          WikiText: ${event.wikiText}`);
      break;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  if (options.help) {
    printHelp();
    process.exit(0);
  }

  let config;
  try {
    config = loadConfig(options.config);
  } catch (err) {
    console.error(`Error loading config: ${err.message}`);
    process.exit(1);
  }

  options.concurrency = resolveConcurrency(options.concurrency, config);

  const tracker = new ProgressTracker(options.progressFile);
  const uploadLog = new UploadLog(options.logFile);

  let filesToProcess = [];
  let sourceDir = options.source;

  if (options.resume) {
    const data = tracker.load();
    if (!data) {
      console.error(`Progress file not found: ${options.resume}`);
      process.exit(1);
    }
    sourceDir = data.sourceDir;
    filesToProcess = tracker.getPendingFiles();
    console.log(`Resuming task ${data.taskId}: ${filesToProcess.length} files pending`);
  } else if (options.retryFailed) {
    tracker.filePath = options.retryFailed;
    const data = tracker.load();
    if (!data) {
      console.error(`Progress file not found: ${options.retryFailed}`);
      process.exit(1);
    }
    sourceDir = data.sourceDir;
    filesToProcess = tracker.getFailedFiles();
    for (const file of filesToProcess) {
      if (!data.pendingFiles.includes(file)) {
        data.pendingFiles.push(file);
      }
    }
    data.failed = [];
    tracker.save();
    console.log(`Retrying ${filesToProcess.length} failed files from task ${data.taskId}`);
  } else {
    if (!options.source) {
      console.error('Error: --source is required for new upload task');
      printHelp();
      process.exit(1);
    }

    if (!fs.existsSync(options.source)) {
      console.error(`Source directory not found: ${options.source}`);
      process.exit(1);
    }

    console.log(`Scanning source directory: ${options.source}`);
    const skipFolders = config.skipFolders || [];
    if (skipFolders.length > 0) {
      console.log(`Skipping folders: ${skipFolders.join(', ')}`);
    }
    const images = collectImages(options.source, skipFolders);
    console.log(`Found ${images.length} images`);

    if (images.length === 0) {
      console.log('No images found. Exiting.');
      process.exit(0);
    }

    filesToProcess = images.map(img => transformPath(img.relativePath));

    const alreadyUploaded = filesToProcess.filter(f => uploadLog.isUploaded(f));
    if (alreadyUploaded.length > 0) {
      console.log(`${alreadyUploaded.length} files already uploaded (will be skipped)`);
      filesToProcess = filesToProcess.filter(f => !uploadLog.isUploaded(f));
    }

    tracker.init(options.source, filesToProcess);
    console.log(`Task ${tracker.data.taskId} created: ${filesToProcess.length} files to upload`);
  }

  if (filesToProcess.length === 0) {
    console.log('No files to process. Exiting.');
    process.exit(0);
  }

  let wiki = null;

  if (!options.dryRun) {
    console.log(`Connecting to wiki: ${config.wiki.prefix}`);
    wiki = new HuijiWiki(config.wiki.prefix, config.wiki.authKey);

    console.log('Logging in...');
    const loginSuccess = await wiki.apiLogin(config.auth.username, config.auth.password);

    if (!loginSuccess) {
      console.error(`Login failed: ${wiki.getLastErrorMessage()}`);
      process.exit(1);
    }
    console.log('Login successful');
  } else {
    console.log('[DRY-RUN MODE] No actual uploads will be performed');
  }

  console.log(`\nStarting upload (concurrency: ${options.concurrency})...\n`);

  const startTime = Date.now();
  const result = await processUploadQueue(
    wiki,
    filesToProcess,
    sourceDir,
    config,
    tracker,
    uploadLog,
    {
      concurrency: options.concurrency,
      dryRun: options.dryRun,
      onProgress: printProgress
    }
  );

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('\n========== Upload Complete ==========');
  console.log(`Total time: ${elapsed}s`);
  console.log(`Completed: ${result.completed}`);
  console.log(`Skipped: ${result.skipped}`);
  console.log(`Failed: ${result.failed}`);

  if (result.failed > 0) {
    console.log(`\nFailed files are recorded in: ${options.progressFile}`);
    console.log('Run with --retry-failed to retry them.');
  }

  const stats = tracker.getStats();
  if (stats && stats.pending === 0 && stats.failed === 0) {
    console.log('\nAll files processed successfully!');
  }
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
