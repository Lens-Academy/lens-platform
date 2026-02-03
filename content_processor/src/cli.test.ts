// src/cli.test.ts
import { describe, it, expect } from 'vitest';
import { parseArgs } from './cli.js';

describe('parseArgs', () => {
  it('extracts vault path from positional argument', () => {
    const args = parseArgs(['node', 'cli.ts', '/path/to/vault']);

    expect(args.vaultPath).toBe('/path/to/vault');
    expect(args.outputPath).toBeNull();
  });

  it('returns null vaultPath when no argument provided', () => {
    const args = parseArgs(['node', 'cli.ts']);

    expect(args.vaultPath).toBeNull();
  });

  it('extracts --output flag', () => {
    const args = parseArgs(['node', 'cli.ts', '/path/to/vault', '--output', '/path/to/output.json']);

    expect(args.vaultPath).toBe('/path/to/vault');
    expect(args.outputPath).toBe('/path/to/output.json');
  });

  it('extracts -o shorthand', () => {
    const args = parseArgs(['node', 'cli.ts', '/path/to/vault', '-o', 'output.json']);

    expect(args.outputPath).toBe('output.json');
  });
});
