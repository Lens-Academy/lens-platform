// content-schema.ts — Single source of truth for content type and segment type field definitions.

export interface ContentTypeSchema {
  /** Fields that must be present and non-empty in frontmatter */
  requiredFields: string[];
  /** Fields that may be present in frontmatter */
  optionalFields: string[];
  /** Combined required + optional (derived, for convenience) */
  allFields: string[];
}

export interface SegmentTypeSchema {
  /** Fields that must be present in this segment type */
  requiredFields: string[];
  /** Fields that may be present in this segment type */
  optionalFields: string[];
  /** Combined required + optional (derived, for convenience) */
  allFields: string[];
  /** Fields that must be 'true' or 'false' */
  booleanFields: string[];
}

function contentSchema(required: string[], optional: string[]): ContentTypeSchema {
  return { requiredFields: required, optionalFields: optional, allFields: [...required, ...optional] };
}

function segmentSchema(required: string[], optional: string[], booleanFields: string[]): SegmentTypeSchema {
  return { requiredFields: required, optionalFields: optional, allFields: [...required, ...optional], booleanFields };
}

export const CONTENT_SCHEMAS: Record<string, ContentTypeSchema> = {
  'module': contentSchema(['slug', 'title'], ['contentId', 'id', 'discussion', 'tags']),
  'course': contentSchema(['slug', 'title'], ['id', 'tags']),
  'lens': contentSchema(['id'], ['tags']),
  'learning-outcome': contentSchema(['id'], ['discussion', 'learning-outcome', 'tags']),
  'article': contentSchema(['title', 'author', 'source_url'], ['date', 'published', 'created', 'description', 'tags', 'url']),
  'video-transcript': contentSchema(['title', 'channel', 'url'], ['tags']),
};

export const SEGMENT_SCHEMAS: Record<string, SegmentTypeSchema> = {
  'text': segmentSchema(['content'], ['optional'], ['optional']),
  'chat': segmentSchema(
    ['instructions'],
    ['optional', 'hidePreviousContentFromUser', 'hidePreviousContentFromTutor'],
    ['optional', 'hidePreviousContentFromUser', 'hidePreviousContentFromTutor'],
  ),
  'article-excerpt': segmentSchema([], ['from', 'to', 'optional'], ['optional']),
  'video-excerpt': segmentSchema(['to'], ['from', 'optional'], ['optional']),
  'question': segmentSchema(
    ['user-instruction'],
    ['assessment-prompt', 'max-time', 'max-chars', 'enforce-voice', 'optional', 'feedback'],
    ['enforce-voice', 'optional', 'feedback'],
  ),
};

/**
 * Valid fields per segment type, derived from SEGMENT_SCHEMAS.
 * Used by segment-fields.ts to check for misplaced fields.
 */
export const VALID_FIELDS_BY_SEGMENT_TYPE: Record<string, Set<string>> = Object.fromEntries(
  Object.entries(SEGMENT_SCHEMAS).map(([type, schema]) => [type, new Set(schema.allFields)])
);

/**
 * Section-level fields used in body sections (not frontmatter, not segments).
 * These are fields like source:: and learningOutcomeId:: used in LO/lens sections.
 */
const SECTION_LEVEL_FIELDS = ['source', 'learningOutcomeId', 'sourceUrl'];

/**
 * All known field names across all content types, derived from schemas.
 * Used by typo detection to suggest corrections for unrecognized fields.
 */
export const ALL_KNOWN_FIELDS: string[] = (() => {
  const fields = new Set<string>();
  for (const schema of Object.values(CONTENT_SCHEMAS)) {
    for (const field of schema.allFields) fields.add(field);
  }
  for (const schema of Object.values(SEGMENT_SCHEMAS)) {
    for (const field of schema.allFields) fields.add(field);
  }
  for (const field of SECTION_LEVEL_FIELDS) fields.add(field);
  return [...fields];
})();

/**
 * All boolean fields across all segment types, derived from schemas.
 */
export const ALL_BOOLEAN_FIELDS: string[] = (() => {
  const fields = new Set<string>();
  for (const schema of Object.values(SEGMENT_SCHEMAS)) {
    for (const field of schema.booleanFields) fields.add(field);
  }
  return [...fields];
})();
