const fs = require('fs');
const path = require('path');

class ProgressTracker {
  constructor(progressFilePath) {
    this.filePath = progressFilePath;
    this.data = null;
  }

  init(sourceDir, files) {
    const now = new Date();
    const taskId = now.toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);

    this.data = {
      taskId,
      sourceDir: path.resolve(sourceDir),
      startTime: now.toISOString(),
      totalFiles: files.length,
      pendingFiles: files.slice(),
      completed: [],
      failed: [],
      lastUpdated: now.toISOString()
    };

    this.save();
    return this.data;
  }

  load() {
    if (!fs.existsSync(this.filePath)) {
      return null;
    }
    const content = fs.readFileSync(this.filePath, 'utf-8');
    this.data = JSON.parse(content);
    return this.data;
  }

  save() {
    if (!this.data) return;
    this.data.lastUpdated = new Date().toISOString();
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
  }

  markCompleted(targetName) {
    if (!this.data) return;
    const idx = this.data.pendingFiles.indexOf(targetName);
    if (idx !== -1) {
      this.data.pendingFiles.splice(idx, 1);
    }
    if (!this.data.completed.includes(targetName)) {
      this.data.completed.push(targetName);
    }
    const failedIdx = this.data.failed.findIndex(f => f.file === targetName);
    if (failedIdx !== -1) {
      this.data.failed.splice(failedIdx, 1);
    }
    this.save();
  }

  markFailed(targetName, error, attempts = 1) {
    if (!this.data) return;
    const idx = this.data.pendingFiles.indexOf(targetName);
    if (idx !== -1) {
      this.data.pendingFiles.splice(idx, 1);
    }
    const existing = this.data.failed.find(f => f.file === targetName);
    if (existing) {
      existing.error = error;
      existing.attempts = attempts;
    } else {
      this.data.failed.push({ file: targetName, error, attempts });
    }
    this.save();
  }

  getPendingFiles() {
    return this.data ? this.data.pendingFiles : [];
  }

  getFailedFiles() {
    return this.data ? this.data.failed.map(f => f.file) : [];
  }

  getStats() {
    if (!this.data) return null;
    return {
      taskId: this.data.taskId,
      total: this.data.totalFiles,
      completed: this.data.completed.length,
      failed: this.data.failed.length,
      pending: this.data.pendingFiles.length
    };
  }

  isComplete() {
    if (!this.data) return false;
    return this.data.pendingFiles.length === 0 && this.data.failed.length === 0;
  }
}

class UploadLog {
  constructor(logFilePath) {
    this.filePath = logFilePath;
    this.uploaded = new Set();
    this.load();
  }

  load() {
    if (!fs.existsSync(this.filePath)) {
      return;
    }
    const content = fs.readFileSync(this.filePath, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim());
    for (const line of lines) {
      const match = line.match(/^\[.*?\]\s+SUCCESS\s+(.+)$/);
      if (match) {
        this.uploaded.add(match[1].trim());
      }
    }
  }

  isUploaded(targetName) {
    return this.uploaded.has(targetName);
  }

  logSuccess(targetName, wikiPrefix) {
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] SUCCESS ${targetName} -> ${wikiPrefix}\n`;
    this.uploaded.add(targetName);
    this.appendLog(logLine);
  }

  logSkipped(targetName, reason) {
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] SKIPPED ${targetName} (${reason})\n`;
    this.appendLog(logLine);
  }

  logFailed(targetName, error) {
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] FAILED  ${targetName} (${error})\n`;
    this.appendLog(logLine);
  }

  appendLog(line) {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.appendFileSync(this.filePath, line, 'utf-8');
  }

  getUploadedCount() {
    return this.uploaded.size;
  }
}

module.exports = { ProgressTracker, UploadLog };
