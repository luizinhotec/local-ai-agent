import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const STATE_DIR = path.resolve(ROOT, 'active', 'state', 'dog-mm');
const LOG_FILE = path.resolve(STATE_DIR, 'dog-mm-ops-log.jsonl');
const OUTPUT_JSON = path.resolve(STATE_DIR, 'dog-mm-paper-summary.json');

function toFiniteNumber(value: unknown, fallback: number | null = null): number | null {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function safeDivide(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null;
  return numerator / denominator;
}

function round(value: number | null, digits = 6): number | null {
  if (!Number.isFinite(value as number)) return null;
  return Number((value as number).toFixed(digits));
}

function average(values: Array<number | null>): number | null {
  const finite = values.filter((value): value is number => Number.isFinite(value));
  if (finite.length === 0) return null;
  return round(finite.reduce((sum, value) => sum + value, 0) / finite.length);
}

export {
  LOG_FILE,
  OUTPUT_JSON,
  average,
  round,
  safeDivide,
  toFiniteNumber,
};
