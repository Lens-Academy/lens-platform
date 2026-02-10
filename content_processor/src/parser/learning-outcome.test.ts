// src/parser/learning-outcome.test.ts
import { describe, it, expect } from 'vitest';
import { parseLearningOutcome } from './learning-outcome.js';

describe('parseLearningOutcome', () => {
  it('parses LO with multiple lenses', () => {
    const content = `---
id: 550e8400-e29b-41d4-a716-446655440001
---

## Lens: First Lens
source:: [[../Lenses/lens1.md|Lens 1]]

## Lens: Second Lens
source:: [[../Lenses/lens2.md|Lens 2]]
optional:: true

## Test: Knowledge Check
source:: [[../Tests/test1.md|Test]]
`;

    const result = parseLearningOutcome(content, 'Learning Outcomes/lo1.md');

    expect(result.learningOutcome?.id).toBe('550e8400-e29b-41d4-a716-446655440001');
    expect(result.learningOutcome?.lenses).toHaveLength(2);
    expect(result.learningOutcome?.lenses[0].source).toBe('[[../Lenses/lens1.md|Lens 1]]');
    expect(result.learningOutcome?.lenses[0].resolvedPath).toBe('Lenses/lens1.md');
    expect(result.learningOutcome?.lenses[0].optional).toBe(false);
    expect(result.learningOutcome?.lenses[1].source).toBe('[[../Lenses/lens2.md|Lens 2]]');
    expect(result.learningOutcome?.lenses[1].resolvedPath).toBe('Lenses/lens2.md');
    expect(result.learningOutcome?.lenses[1].optional).toBe(true);
    expect(result.learningOutcome?.test?.source).toContain('test1.md');
    expect(result.learningOutcome?.test?.resolvedPath).toBe('Tests/test1.md');
    expect(result.errors).toHaveLength(0);
  });

  it('requires id in frontmatter', () => {
    const content = `---
discussion: some-link
---

## Lens: Test
source:: [[../Lenses/lens1.md|Lens]]
`;

    const result = parseLearningOutcome(content, 'Learning Outcomes/bad.md');

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain('id');
  });

  it('requires at least one lens', () => {
    const content = `---
id: 550e8400-e29b-41d4-a716-446655440001
---

No lenses here.
`;

    const result = parseLearningOutcome(content, 'Learning Outcomes/empty.md');

    expect(result.errors.some(e => e.message.includes('Lens'))).toBe(true);
  });

  it('allows test section without source:: field (tests not implemented yet)', () => {
    const content = `---
id: 550e8400-e29b-41d4-a716-446655440001
---

## Lens: Main Content
source:: [[../Lenses/lens1.md|Lens 1]]

## Test: Knowledge Check
`;

    const result = parseLearningOutcome(content, 'Learning Outcomes/lo1.md');

    // Should NOT produce an error for missing source:: in test section
    expect(result.errors).toHaveLength(0);
    // The LO should be parsed successfully
    expect(result.learningOutcome?.id).toBe('550e8400-e29b-41d4-a716-446655440001');
    expect(result.learningOutcome?.lenses).toHaveLength(1);
    // Test should be undefined since no source was provided
    expect(result.learningOutcome?.test).toBeUndefined();
  });

  it('errors when id is a number', () => {
    const content = `---
id: 12345
---

## Lens: Test
source:: [[../Lenses/lens1.md|Lens]]
`;

    const result = parseLearningOutcome(content, 'Learning Outcomes/bad.md');

    expect(result.errors.some(e =>
      e.severity === 'error' &&
      e.message.includes('id') &&
      e.message.includes('string')
    )).toBe(true);
  });
});
