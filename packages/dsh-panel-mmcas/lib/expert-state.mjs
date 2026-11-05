import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const VERSION = 1;
const MAX_JOBS = 100;

function now() {
  return new Date().toISOString();
}

function jobId() {
  return 'EXP-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
}

function readState(file) {
  try {
    if (!existsSync(file)) return { version: VERSION, jobs: [] };
    const value = JSON.parse(readFileSync(file, 'utf8'));
    if (!value || !Array.isArray(value.jobs)) return { version: VERSION, jobs: [] };
    return { version: VERSION, jobs: value.jobs };
  } catch {
    return { version: VERSION, jobs: [] };
  }
}

function writeState(file, state) {
  const jobs = state.jobs.slice(-MAX_JOBS);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ version: VERSION, jobs }, null, 2) + '\n');
}

export function createExpertStore(file) {
  return {
    start({ mode, dimension, requester, model }) {
      const state = readState(file);
      const job = {
        id: jobId(),
        mode,
        dimension,
        requester: requester || '',
        model: model || '',
        status: 'running',
        startedAt: now(),
        endedAt: null,
        reportPath: null,
        elapsedS: null,
        estFee: null,
        error: null,
      };
      state.jobs.push(job);
      writeState(file, state);
      return job;
    },
    finish(id, result = {}) {
      const state = readState(file);
      const job = state.jobs.find((item) => item.id === id);
      if (!job) return null;
      job.status = result.ok ? 'ready' : 'failed';
      job.endedAt = now();
      job.reportPath = result.reportPath || null;
      job.elapsedS = result.elapsedS ?? null;
      job.estFee = result.estFee ?? null;
      job.error = result.ok ? null : (result.error || 'failed');
      writeState(file, state);
      return job;
    },
    list(mode, limit = 10) {
      const jobs = readState(file).jobs.filter((job) => !mode || job.mode === mode);
      return jobs.slice(-Math.max(1, limit)).reverse();
    },
    get(id) {
      return readState(file).jobs.find((job) => job.id === id) || null;
    },
    recoverInterrupted() {
      const state = readState(file);
      let count = 0;
      for (const job of state.jobs) {
        if (job.status !== 'running') continue;
        job.status = 'interrupted';
        job.endedAt = now();
        job.error = 'host restarted';
        count++;
      }
      if (count) writeState(file, state);
      return count;
    },
    file,
  };
}
