# WIP Pass-Through Design

**Problem:** When a tier violation occurs (e.g., production module references a WIP learning outcome), the flattener drops the WIP content from the output entirely. The error is reported, but the sections/segments are empty.

**Decision:** The parser/flattener should be flexible (always include content). The validator should be strict (always report errors). These are separate concerns. A tier violation is a validation error, not a reason to exclude content from the output.

**Scope:** 5 locations in `content_processor/src/flattener/index.ts` where tier violations cause early returns. The `validator-ignore` tier continues to skip content entirely (unchanged).

**Approach:** Remove the early return/continue after `errors.push(violation)` at each tier violation check. The error is still emitted; the content processing continues normally.
