// src/validator/chat-precedence.test.ts
import { describe, it, expect } from 'vitest';
import { validateChatPrecedence } from './chat-precedence.js';

describe('validateChatPrecedence', () => {
  it('allows Chat immediately after Text', () => {
    const errors = validateChatPrecedence(
      [
        { type: 'text', line: 10 },
        { type: 'chat', line: 20 },
      ],
      'test.md'
    );

    expect(errors).toHaveLength(0);
  });

  it('errors when Chat is the first segment', () => {
    const errors = validateChatPrecedence(
      [{ type: 'chat', line: 10 }],
      'test.md'
    );

    expect(errors).toHaveLength(1);
    expect(errors[0].severity).toBe('error');
    expect(errors[0].message).toContain('Chat');
    expect(errors[0].message).toContain('Text');
    expect(errors[0].line).toBe(10);
  });

  it('errors when Chat follows Article-excerpt', () => {
    const errors = validateChatPrecedence(
      [
        { type: 'text', line: 10 },
        { type: 'article-excerpt', line: 20 },
        { type: 'chat', line: 30 },
      ],
      'test.md'
    );

    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('article-excerpt');
  });

  it('errors when Chat follows another Chat', () => {
    const errors = validateChatPrecedence(
      [
        { type: 'text', line: 10 },
        { type: 'chat', line: 20 },
        { type: 'chat', line: 30 },
      ],
      'test.md'
    );

    expect(errors).toHaveLength(1);
    expect(errors[0].line).toBe(30);
  });

  it('reports multiple violations', () => {
    const errors = validateChatPrecedence(
      [
        { type: 'chat', line: 10 },
        { type: 'text', line: 20 },
        { type: 'video-excerpt', line: 30 },
        { type: 'chat', line: 40 },
      ],
      'test.md'
    );

    expect(errors).toHaveLength(2);
    expect(errors[0].line).toBe(10);
    expect(errors[1].line).toBe(40);
  });

  it('allows sections with no Chat segments', () => {
    const errors = validateChatPrecedence(
      [
        { type: 'text', line: 10 },
        { type: 'article-excerpt', line: 20 },
        { type: 'text', line: 30 },
      ],
      'test.md'
    );

    expect(errors).toHaveLength(0);
  });

  it('allows multiple Text-Chat pairs', () => {
    const errors = validateChatPrecedence(
      [
        { type: 'text', line: 10 },
        { type: 'chat', line: 20 },
        { type: 'text', line: 30 },
        { type: 'chat', line: 40 },
      ],
      'test.md'
    );

    expect(errors).toHaveLength(0);
  });

  it('includes file path in errors', () => {
    const errors = validateChatPrecedence(
      [{ type: 'chat', line: 5 }],
      'Lenses/my-lens.md'
    );

    expect(errors[0].file).toBe('Lenses/my-lens.md');
  });
});
