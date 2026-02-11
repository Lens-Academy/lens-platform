import { describe, it, expect } from 'vitest';
import { CONTENT_SCHEMAS, SEGMENT_SCHEMAS } from './content-schema.js';

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
    expect(schema.optionalFields).toEqual(['contentId', 'id', 'discussion']);
  });

  it('course schema has correct required and optional fields', () => {
    const schema = CONTENT_SCHEMAS['course'];
    expect(schema.requiredFields).toEqual(['slug', 'title']);
    expect(schema.optionalFields).toEqual([]);
  });

  it('lens schema has correct required and optional fields', () => {
    const schema = CONTENT_SCHEMAS['lens'];
    expect(schema.requiredFields).toEqual(['id']);
    expect(schema.optionalFields).toEqual([]);
  });

  it('learning-outcome schema has correct required and optional fields', () => {
    const schema = CONTENT_SCHEMAS['learning-outcome'];
    expect(schema.requiredFields).toEqual(['id']);
    expect(schema.optionalFields).toEqual(['discussion']);
  });

  it('article schema has correct required and optional fields', () => {
    const schema = CONTENT_SCHEMAS['article'];
    expect(schema.requiredFields).toEqual(['title', 'author', 'source_url']);
    expect(schema.optionalFields).toEqual(['date']);
  });

  it('video-transcript schema has correct required and optional fields', () => {
    const schema = CONTENT_SCHEMAS['video-transcript'];
    expect(schema.requiredFields).toEqual(['title', 'channel', 'url']);
    expect(schema.optionalFields).toEqual([]);
  });

  it('allFields returns combined required + optional', () => {
    const schema = CONTENT_SCHEMAS['module'];
    expect(schema.allFields).toEqual(['slug', 'title', 'contentId', 'id', 'discussion']);
  });
});

describe('SEGMENT_SCHEMAS', () => {
  it('defines schemas for all 4 segment types', () => {
    expect(Object.keys(SEGMENT_SCHEMAS)).toEqual(
      expect.arrayContaining(['text', 'chat', 'article-excerpt', 'video-excerpt'])
    );
    expect(Object.keys(SEGMENT_SCHEMAS)).toHaveLength(4);
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
