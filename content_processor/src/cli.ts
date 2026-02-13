#!/usr/bin/env node
// src/cli.ts
import { readVaultFiles } from './fs/read-vault.js';
import { processContent, ProcessResult } from './index.js';
import { validateUrls } from './validator/url-reachability.js';
import { writeFile } from 'fs/promises';

export interface CliOptions {
  vaultPath: string | null;
  outputPath: string | null;
  includeWip: boolean;
  stdin: boolean;  // NEW
}

export function parseArgs(argv: string[]): CliOptions {
  const args = argv.slice(2);
  let vaultPath: string | null = null;
  let outputPath: string | null = null;
  let includeWip = false;
  let stdin = false;  // NEW

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--output' || args[i] === '-o') {
      outputPath = args[i + 1] || null;
      i++; // skip next arg
    } else if (args[i] === '--include-wip') {
      includeWip = true;
    } else if (args[i] === '--stdin') {  // NEW
      stdin = true;
    } else if (!args[i].startsWith('-')) {
      vaultPath = args[i];
    }
  }

  return { vaultPath, outputPath, includeWip, stdin };
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

export async function run(options: CliOptions): Promise<ProcessResult> {
  let files: Map<string, string>;

  if (options.stdin) {
    // Read JSON from stdin: { "path": "content", ... }
    const input = await readStdin();
    const parsed = JSON.parse(input) as Record<string, string>;
    files = new Map(Object.entries(parsed));
  } else {
    if (!options.vaultPath) {
      throw new Error('Vault path is required (or use --stdin)');
    }
    files = await readVaultFiles(options.vaultPath, { includeWip: options.includeWip });
  }

  return processContent(files, { includeWip: options.includeWip });
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv);

  if (!options.vaultPath && !options.stdin) {
    console.error('Usage: npx tsx src/cli.ts <vault-path> [--output <file>] [--include-wip]');
    console.error('       npx tsx src/cli.ts --stdin [--output <file>]');
    process.exit(1);
  }

  try {
    const result = await run(options);

    // Async URL reachability validation
    if (result.urlsToValidate.length > 0) {
      const urlWarnings = await validateUrls(result.urlsToValidate);
      result.errors.push(...urlWarnings);
    }

    const json = JSON.stringify(result, null, 2);

    if (options.outputPath) {
      await writeFile(options.outputPath, json, 'utf-8');
      console.error(`Written to ${options.outputPath}`);
    } else {
      console.log(json);
    }
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// Run if executed directly (not imported as a module)
// Check for cli.ts, cli.js, or lens-content-processor (when run as npx binary)
const scriptName = process.argv[1] || '';
const isMainModule = scriptName.includes('cli.ts') ||
                     scriptName.includes('cli.js') ||
                     scriptName.endsWith('lens-content-processor');
if (isMainModule) {
  main();
}
