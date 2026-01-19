const fs = require('fs');
const path = require('path');

const IMAGE_EXTENSIONS = ['.webp', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.bmp', '.ico'];

function collectImages(sourceDir, skipFolders = []) {
  const results = [];
  const skipSet = new Set(skipFolders.map(f => f.toLowerCase()));

  function walk(dir, relativePath = '') {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        if (skipSet.has(entry.name.toLowerCase())) {
          continue;
        }
        walk(fullPath, relPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (IMAGE_EXTENSIONS.includes(ext)) {
          results.push({
            absolutePath: fullPath,
            relativePath: relPath
          });
        }
      }
    }
  }

  walk(sourceDir);
  return results;
}

function transformPath(relativePath) {
  return relativePath.replace(/\//g, '-');
}

function sanitizeFileName(fileName) {
  return fileName
    .replace(/:/g, '_')
    .replace(/[#?<>|"\\]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractCategories(relativePath, config) {
  const parts = relativePath.split('/');
  const categoryMapping = config.categoryMapping || {};

  const result = {
    folder: null,
    folderChinese: null,
    bookId: null
  };

  if (parts.length >= 2) {
    result.folder = parts[0];
    const folderLower = parts[0].toLowerCase();
    result.folderChinese = categoryMapping[folderLower] || null;
  }

  if (parts.length >= 3) {
    result.bookId = parts[1];
  }

  return result;
}

function generateWikiText(categories, config) {
  const parts = [];

  parts.push('[[Category:插图]]');

  if (categories.bookId) {
    parts.push(`[[Category:${categories.bookId}]]`);
  }

  if (categories.folderChinese) {
    parts.push(`[[Category:${categories.folderChinese}]]`);
  } else if (categories.folder) {
    parts.push(`[[Category:${categories.folder}]]`);
  }

  if (categories.bookId) {
    parts.push(`[[Category:${categories.bookId}插图]]`);
  }

  return parts.join('');
}

async function uploadSingleImage(wiki, filePath, targetName, wikiText, comment, retries = 3) {
  let lastError = null;

  // Step 1: Upload the image
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const result = await wiki.uploadImage(filePath, targetName, {
        comment: comment
      });

      if (result.error) {
        if (result.error.code === 'fileexists-no-change') {
          return { success: true, skipped: true, message: 'File already exists with same content' };
        }
        throw new Error(`${result.error.code}: ${result.error.info}`);
      }

      // Step 2: Edit the file page to add categories
      const filePageTitle = `File:${targetName}`;
      const editResult = await editFilePage(wiki, filePageTitle, wikiText, comment, retries);

      if (!editResult.success) {
        return {
          success: true,
          skipped: false,
          filename: result.upload?.filename || targetName,
          warning: `Upload OK, but category edit failed: ${editResult.error}`
        };
      }

      return { success: true, skipped: false, filename: result.upload?.filename || targetName };
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        await sleep(1000 * attempt);
      }
    }
  }

  return { success: false, error: lastError?.message || 'Unknown error', attempts: retries };
}

async function editFilePage(wiki, pageTitle, wikiText, comment, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const result = await wiki.editPage(pageTitle, wikiText, {
        isBot: true,
        summary: comment
      });

      if (result.error) {
        throw new Error(`${result.error.code}: ${result.error.info}`);
      }

      return { success: true };
    } catch (err) {
      if (attempt < retries) {
        await sleep(500 * attempt);
      } else {
        return { success: false, error: err.message };
      }
    }
  }
  return { success: false, error: 'Max retries exceeded' };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function processUploadQueue(wiki, files, sourceDir, config, tracker, uploadLog, options = {}) {
  const { concurrency, dryRun = false, onProgress } = options;
  const normalizeConcurrency = (value) => (
    Number.isFinite(value) ? Math.max(1, Math.floor(value)) : null
  );
  const requestedConcurrency = normalizeConcurrency(concurrency);
  const configMaxConcurrency = normalizeConcurrency(
    config?.upload?.maxConcurrency ?? config?.upload?.concurrency
  );
  const maxConcurrency = requestedConcurrency
    ? (configMaxConcurrency ? Math.min(requestedConcurrency, configMaxConcurrency) : requestedConcurrency)
    : (configMaxConcurrency ?? 1);
  const comment = config.upload?.comment || 'Batch image upload';
  const wikiPrefix = config.wiki?.prefix || 'unknown';
  const skipFolders = config.skipFolders || [];

  let completed = 0;
  let failed = 0;
  let skipped = 0;

  const imageFilesCache = collectImages(sourceDir, skipFolders);
  const pathMap = new Map();
  for (const img of imageFilesCache) {
    pathMap.set(transformPath(img.relativePath), img.relativePath);
  }

  let nextIndex = 0;

  async function worker() {
    while (true) {
      const index = nextIndex++;
      if (index >= files.length) {
        return;
      }

      const targetName = files[index];
      const originalRelPath = pathMap.get(targetName);

      if (!originalRelPath) {
        if (onProgress) onProgress({ type: 'error', file: targetName, message: 'Source file not found' });
        tracker.markFailed(targetName, 'Source file not found');
        uploadLog.logFailed(targetName, 'Source file not found');
        failed++;
        continue;
      }

      if (uploadLog.isUploaded(targetName)) {
        if (onProgress) onProgress({ type: 'skip', file: targetName, reason: 'Already uploaded' });
        tracker.markCompleted(targetName);
        skipped++;
        continue;
      }

      const absolutePath = path.join(sourceDir, originalRelPath);
      const categories = extractCategories(originalRelPath, config);
      const wikiText = generateWikiText(categories, config);
      const sanitizedName = sanitizeFileName(targetName);

      if (dryRun) {
        if (onProgress) {
          onProgress({
            type: 'dry-run',
            file: targetName,
            sanitizedName,
            categories,
            wikiText,
            filePageTitle: `File:${sanitizedName}`
          });
        }
        completed++;
        continue;
      }

      if (onProgress) onProgress({ type: 'uploading', file: targetName });

      const result = await uploadSingleImage(wiki, absolutePath, sanitizedName, wikiText, comment);

      if (result.success) {
        if (result.skipped) {
          if (onProgress) onProgress({ type: 'skip', file: targetName, reason: result.message });
          skipped++;
        } else {
          if (result.warning) {
            if (onProgress) onProgress({ type: 'warning', file: targetName, message: result.warning });
          } else {
            if (onProgress) onProgress({ type: 'success', file: targetName });
          }
          completed++;
        }
        tracker.markCompleted(targetName);
        uploadLog.logSuccess(targetName, wikiPrefix);
      } else {
        if (onProgress) onProgress({ type: 'error', file: targetName, message: result.error });
        tracker.markFailed(targetName, result.error, result.attempts);
        uploadLog.logFailed(targetName, result.error);
        failed++;
      }
    }
  }

  const workerCount = Math.min(maxConcurrency, files.length);
  const workers = Array.from({ length: workerCount }, () => worker());
  await Promise.all(workers);

  return { completed, failed, skipped };
}

module.exports = {
  collectImages,
  transformPath,
  sanitizeFileName,
  extractCategories,
  generateWikiText,
  uploadSingleImage,
  editFilePage,
  processUploadQueue,
  IMAGE_EXTENSIONS
};
