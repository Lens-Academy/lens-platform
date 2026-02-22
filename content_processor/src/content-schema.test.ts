import { describe, it, expect } from 'vitest';
import { CONTENT_SCHEMAS, SEGMENT_SCHEMAS, ALL_KNOWN_FIELDS, ALL_BOOLEAN_FIELDS, VALID_FIELDS_BY_SEGMENT_TYPE } from './content-schema.js';

describe('CONTENT_SCHEMAS', () => {
  it('defines schemas for all 6 content types', () => {
    expect(Object.keys(CONTENT_SCHEMAS)).toEqual(
      expect.arrayContaining(['module', 'course', 'lens', 'learning-outcome', 'article', 'video-transcript'])
    );
    expect(Object.keys(CONTENT_SCHEMAS)).toHaveLength(6);
  });

  it('module schema has correct required and optional fields', () => {
    const schema = CONTENT_SCHEMAS['module'];
    expect(schema.requiredFields).toEqual(['slug', 'title']);
    expect(schema.optionalFields).toEqual(['contentId', 'id', 'discussion', 'tags']);
  });

  it('course schema has correct required and optional fields', () => {
    const schema = CONTENT_SCHEMAS['course'];
    expect(schema.requiredFields).toEqual(['slug', 'title']);
    expect(schema.optionalFields).toEqual(['id', 'tags']);
  });

  it('lens schema has correct required and optional fields', () => {
    const schema = CONTENT_SCHEMAS['lens'];
    expect(schema.requiredFields).toEqual(['id']);
    expect(schema.optionalFields).toEqual(['tags']);
  });

  it('learning-outcome schema has correct required and optional fields', () => {
    const schema = CONTENT_SCHEMAS['learning-outcome'];
    expect(schema.requiredFields).toEqual(['id']);
    expect(schema.optionalFields).toEqual(['discussion', 'learning-outcome', 'tags']);
  });

  it('article schema has correct required and optional fields', () => {
    const schema = CONTENT_SCHEMAS['article'];
    expect(schema.requiredFields).toEqual(['title', 'author', 'source_url']);
    expect(schema.optionalFields).toEqual(['date', 'published', 'created', 'description', 'tags', 'url']);
  });

  it('video-transcript schema has correct required and optional fields', () => {
    const schema = CONTENT_SCHEMAS['video-transcript'];
    expect(schema.requiredFields).toEqual(['title', 'channel', 'url']);
    expect(schema.optionalFields).toEqual(['tags']);
  });

  it('allFields returns combined required + optional', () => {
    const schema = CONTENT_SCHEMAS['module'];
    expect(schema.allFields).toEqual(['slug', 'title', 'contentId', 'id', 'discussion', 'tags']);
  });
});

describe('SEGMENT_SCHEMAS', () => {
  it('defines schemas for all 5 segment types', () => {
    expect(Object.keys(SEGMENT_SCHEMAS)).toEqual(
      expect.arrayContaining(['text', 'chat', 'article-excerpt', 'video-excerpt', 'question'])
    );
    expect(Object.keys(SEGMENT_SCHEMAS)).toHaveLength(5);
  });

  it('text segment has correct fields', () => {
    const schema = SEGMENT_SCHEMAS['text'];
    expect(schema.requiredFields).toEqual(['content']);
    expect(schema.optionalFields).toEqual(['optional']);
  });

  it('chat segment has correct fields', () => {
    const schema = SEGMENT_SCHEMAS['chat'];
    expect(schema.requiredFields).toEqual(['instructions']);
    expect(schema.optionalFields).toEqual(
      expect.arrayContaining(['optional', 'hidePreviousContentFromUser', 'hidePreviousContentFromTutor'])
    );
  });

  it('article-excerpt segment has correct fields', () => {
    const schema = SEGMENT_SCHEMAS['article-excerpt'];
    expect(schema.requiredFields).toEqual([]);
    expect(schema.optionalFields).toEqual(expect.arrayContaining(['from', 'to', 'optional']));
  });

  it('video-excerpt segment has correct fields', () => {
    const schema = SEGMENT_SCHEMAS['video-excerpt'];
    expect(schema.requiredFields).toEqual(['to']);
    expect(schema.optionalFields).toEqual(expect.arrayContaining(['from', 'optional']));
  });

  it('booleanFields lists the boolean fields', () => {
    const schema = SEGMENT_SCHEMAS['chat'];
    expect(schema.booleanFields).toEqual(
      expect.arrayContaining(['optional', 'hidePreviousContentFromUser', 'hidePreviousContentFromTutor'])
    );
    const textSchema = SEGMENT_SCHEMAS['text'];
    expect(textSchema.booleanFields).toEqual(['optional']);
  });
});

describe('derived field lists', () => {
  it('ALL_KNOWN_FIELDS includes all frontmatter fields from all content types', () => {
    expect(ALL_KNOWN_FIELDS).toContain('slug');
    expect(ALL_KNOWN_FIELDS).toContain('author');
    expect(ALL_KNOWN_FIELDS).toContain('channel');
    expect(ALL_KNOWN_FIELDS).toContain('discussion');
  });

  it('ALL_KNOWN_FIELDS includes all segment fields', () => {
    expect(ALL_KNOWN_FIELDS).toContain('content');
    expect(ALL_KNOWN_FIELDS).toContain('instructions');
    expect(ALL_KNOWN_FIELDS).toContain('hidePreviousContentFromUser');
    expect(ALL_KNOWN_FIELDS).toContain('from');
    expect(ALL_KNOWN_FIELDS).toContain('to');
  });

  it('ALL_KNOWN_FIELDS includes section-level fields not in segments', () => {
    expect(ALL_KNOWN_FIELDS).toContain('source');
    expect(ALL_KNOWN_FIELDS).toContain('learningOutcomeId');
  });

  it('ALL_KNOWN_FIELDS has no duplicates', () => {
    const unique = new Set(ALL_KNOWN_FIELDS);
    expect(unique.size).toBe(ALL_KNOWN_FIELDS.length);
  });

  it('ALL_BOOLEAN_FIELDS includes optional and hide fields', () => {
    expect(ALL_BOOLEAN_FIELDS).toContain('optional');
    expect(ALL_BOOLEAN_FIELDS).toContain('hidePreviousContentFromUser');
    expect(ALL_BOOLEAN_FIELDS).toContain('hidePreviousContentFromTutor');
  });

  it('ALL_BOOLEAN_FIELDS has no duplicates', () => {
    const unique = new Set(ALL_BOOLEAN_FIELDS);
    expect(unique.size).toBe(ALL_BOOLEAN_FIELDS.length);
  });
});

describe('VALID_FIELDS_BY_SEGMENT_TYPE (derived)', () => {
  it('text segment allows content and optional', () => {
    expect(VALID_FIELDS_BY_SEGMENT_TYPE['text']).toEqual(new Set(['content', 'optional']));
  });

  it('chat segment allows instructions, optional, and hide fields', () => {
    expect(VALID_FIELDS_BY_SEGMENT_TYPE['chat']).toEqual(new Set([
      'instructions', 'optional', 'hidePreviousContentFromUser', 'hidePreviousContentFromTutor',
    ]));
  });

  it('article-excerpt allows from, to, optional', () => {
    expect(VALID_FIELDS_BY_SEGMENT_TYPE['article-excerpt']).toEqual(new Set(['from', 'to', 'optional']));
  });

  it('video-excerpt allows from, to, optional', () => {
    expect(VALID_FIELDS_BY_SEGMENT_TYPE['video-excerpt']).toEqual(new Set(['from', 'to', 'optional']));
  });
});
