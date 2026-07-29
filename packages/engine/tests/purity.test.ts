import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The purity contract, enforced rather than trusted.
 *
 * Every guarantee this project makes about replay determinism rests on the engine
 * being a pure function of its inputs. That is easy to state and easy to break by
 * accident — one `Date.now()` for a "temporary" log line and every recorded game
 * becomes unreproducible. These tests fail the build instead.
 */

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const sourceRoot = join(packageRoot, 'src');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
  });
}

function readManifest(): Record<string, unknown> {
  const raw = readFileSync(join(packageRoot, 'package.json'), 'utf8');
  return JSON.parse(raw) as Record<string, unknown>;
}

describe('the engine manifest', () => {
  it('declares no runtime dependencies', () => {
    const manifest = readManifest();
    expect(manifest['dependencies']).toBeUndefined();
    expect(manifest['peerDependencies']).toBeUndefined();
    expect(manifest['optionalDependencies']).toBeUndefined();
  });
});

describe('the engine source', () => {
  const files = sourceFiles(sourceRoot);

  it('contains source to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each([
    ['react', /from\s+['"]react/],
    ['next', /from\s+['"]next/],
    ['supabase', /from\s+['"]@supabase/],
    ['zod', /from\s+['"]zod['"]/],
    ['a node built-in', /from\s+['"](?:node:|fs|path|crypto|util|os|buffer)['"]/],
  ])('imports no %s', (_label, pattern) => {
    const offenders = files.filter((file) => pattern.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it.each([
    ['Date.now', /\bDate\.now\s*\(/],
    ['new Date', /\bnew\s+Date\b/],
    ['Math.random', /\bMath\.random\s*\(/],
    ['crypto', /\bcrypto\./],
    ['process', /\bprocess\./],
  ])('never reads %s', (_label, pattern) => {
    const offenders = files.filter((file) => pattern.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
