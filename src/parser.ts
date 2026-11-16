import { TrackedSpan } from "./types";

/**
 * Scan document text and return all `%%...%%` (comment / deletion) and `++...++` (addition) spans,
 * sorted by `from` offset ascending.
 *
 * - `%%...%%` may span multiple lines (Obsidian native comment behavior).
 * - `++...++` is matched per-line to avoid pairing stray `++` across distant paragraphs.
 */
export function findTrackedSpans(text: string): TrackedSpan[] {
  const spans: TrackedSpan[] = [];
  const commentRanges: Array<{ from: number; to: number }> = [];

  // 1. Find all %%...%% spans (comments and %%~~...~~%% deletions).
  let idx = 0;
  while (idx < text.length) {
    const open = text.indexOf("%%", idx);
    if (open === -1) break;

    const close = text.indexOf("%%", open + 2);
    if (close === -1) break;

    const end = close + 2;
    const inner = text.slice(open + 2, close);
    if (inner.length >= 4 && inner.startsWith("~~") && inner.endsWith("~~")) {
      spans.push({
        kind: "deletion",
        from: open,
        to: end,
        innerFrom: open + 4,
        innerTo: close - 2,
      });
    } else {
      spans.push({
        kind: "comment",
        from: open,
        to: end,
        innerFrom: open + 2,
        innerTo: close,
      });
    }

    commentRanges.push({ from: open, to: end });
    idx = end;
  }

  // Helper to check if an offset falls inside any %%...%% span.
  const isInComment = (pos: number): boolean => {
    for (const r of commentRanges) {
      if (pos >= r.from && pos < r.to) return true;
      if (r.from > pos) break;
    }
    return false;
  };

  // 2. Find ++...++ spans per-line, skipping positions inside %%...%%.
  let lineStart = 0;
  while (lineStart <= text.length) {
    const nl = text.indexOf("\n", lineStart);
    const lineEnd = nl === -1 ? text.length : nl;

    let pos = lineStart;
    while (pos < lineEnd) {
      const open = text.indexOf("++", pos);
      if (open === -1 || open >= lineEnd) break;

      if (isInComment(open)) {
        pos = open + 2;
        continue;
      }

      let searchFrom = open + 2;
      let close = -1;
      while (searchFrom < lineEnd) {
        const candidate = text.indexOf("++", searchFrom);
        if (candidate === -1 || candidate >= lineEnd) break;
        if (!isInComment(candidate)) {
          close = candidate;
          break;
        }
        searchFrom = candidate + 2;
      }

      if (close === -1) break;

      const end = close + 2;
      spans.push({
        kind: "addition",
        from: open,
        to: end,
        innerFrom: open + 2,
        innerTo: close,
      });
      pos = end;
    }

    if (nl === -1) break;
    lineStart = nl + 1;
  }

  spans.sort((a, b) => a.from - b.from);
  return spans;
}

/**
 * Returns true if `pos` is strictly inside the delimiters of any `++...++` or `%%...%%` span
 * (including right after opening `++`/`%%` and right before closing `++`/`%%`).
 */
export function isInsideTrackedMarkup(spans: TrackedSpan[], pos: number): boolean {
  for (const span of spans) {
    if (pos >= span.from + 2 && pos <= span.to - 2) {
      return true;
    }
    if (span.from > pos) break;
  }
  return false;
}

/**
 * Returns the span enclosing `pos` (strictly inside delimiters `from + 2 .. to - 2`), or null.
 */
export function getEnclosingSpan(spans: TrackedSpan[], pos: number): TrackedSpan | null {
  for (const span of spans) {
    if (pos >= span.from + 2 && pos <= span.to - 2) {
      return span;
    }
    if (span.from > pos) break;
  }
  return null;
}

/**
 * Returns the addition or deletion span at or touching `pos` (inclusive of outer delimiters),
 * used for Accept / Reject at cursor.
 */
export function findActionableSpanAt(spans: TrackedSpan[], pos: number): TrackedSpan | null {
  for (const span of spans) {
    if (span.kind === "comment") continue;
    if (pos >= span.from && pos <= span.to) {
      return span;
    }
    if (span.from > pos) break;
  }
  return null;
}
