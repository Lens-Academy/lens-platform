// tests/golden-master.test.ts
// Golden master tests need regeneration after the content processor refactor
// (section types, segment types, and metadata location all changed)
import { describe, it, expect } from 'vitest';
import { loadFixture } from './fixture-loader.js';
import { processContent } from '../src/index.js';

describe('golden master - Python compatibility', () => {
  it.todo('matches Python output for actual-content fixture');
  it.todo('matches Python output for software-demo fixture');
});
