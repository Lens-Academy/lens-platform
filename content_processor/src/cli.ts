// src/cli.ts
import { readVaultFiles } from './fs/read-vault.js';
import { processContent, ProcessResult } from './index.js';
import { writeFile } from 'fs/promises';

export interface CliOptions {
  vaultPath: string | null;
  outputPath: string | null;
  includeWip: boolean;
}

export function parseArgs(argv: string[]): CliOptions {
  const args = argv.slice(2);
  let vaultPath: string | null = null;
  let outputPath: string | null = null;
  let includeWip = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--output' || args[i] === '-o') {
      outputPath = args[i + 1] || null;
      i++; // skip next arg
    } else if (args[i] === '--include-wip') {
      includeWip = true;
    } else if (!args[i].startsWith('-')) {
      vaultPath = args[i];
    }
  }

  return { vaultPath, outputPath, includeWip };
}

export async function run(options: CliOptions): Promise<ProcessResult> {
  if (!options.vaultPath) {
    throw new Error('Vault path is required');
  }

  const files = await readVaultFiles(options.vaultPath, { includeWip: options.includeWip });
  return processContent(files);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv);

  if (!options.vaultPath) {
    console.error('Usage: npx tsx src/cli.ts <vault-path> [--output <file>] [--include-wip]');
    process.exit(1);
  }

  try {
    const result = await run(options);
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
const isMainModule = process.argv[1]?.includes('cli.ts') || process.argv[1]?.includes('cli.js');
if (isMainModule) {
  main();
}
