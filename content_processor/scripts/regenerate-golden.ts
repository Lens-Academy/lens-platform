// scripts/regenerate-golden.ts
// Regenerate expected.json files for golden master tests using TypeScript processor output
import { loadFixture, listFixtures } from '../tests/fixture-loader.js';
import { processContent } from '../src/index.js';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const fixtures = await listFixtures();
  const goldenFixtures = fixtures.filter((f) => f.startsWith('golden/'));

  console.log(`Found ${goldenFixtures.length} golden fixtures to regenerate:`);
  for (const name of goldenFixtures) {
    console.log(`  - ${name}`);
  }
  console.log('');

  for (const name of goldenFixtures) {
    console.log(`Processing: ${name}`);

    const fixture = await loadFixture(name);
    const result = processContent(fixture.input);

    const outputPath = join(__dirname, '../fixtures', name, 'expected.json');
    writeFileSync(outputPath, JSON.stringify(result, null, 2) + '\n');
    console.log(`  Updated: ${outputPath}`);

    // Print some stats about the result
    console.log(`  Stats:`);
    console.log(`    - Modules: ${result.modules.length}`);
    console.log(`    - Courses: ${result.courses.length}`);
    console.log(`    - Errors: ${result.errors.length}`);

    // Show section counts per module
    for (const mod of result.modules) {
      console.log(`    - Module "${mod.slug}": ${mod.sections.length} sections`);
    }
    console.log('');
  }

  console.log('Done! All golden expected.json files regenerated.');
  console.log('');
  console.log('Next steps:');
  console.log('  1. Run tests: npm test -- golden-master');
  console.log('  2. Manually inspect the generated JSON');
  console.log('  3. Commit with: jj describe -m "feat(golden): regenerate expected.json"');
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
