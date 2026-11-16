import { TrackedSpan } from "./types";

/**
 * Scan document text and return all `%%...%%` (comment / deletion), `++...++` (addition),
 * and `<ins>...</ins>` (fallback HTML addition) spans, sorted by `from` offset ascending.
 *
 * - `%%...%%` may span multiple lines (Obsidian native comment behavior).
 * - `++...++` and `<ins>...</ins>` are matched per-line to avoid pairing stray markers across paragraphs.
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

  const isInComment = (pos: number): boolean => {
    for (const r of commentRanges) {
      if (pos >= r.from && pos < r.to) return true;
      if (r.from > pos) break;
    }
    return false;
  };

  // 2. Find ++...++ and <ins>...</ins> spans per-line, skipping positions inside %%...%%.
  let lineStart = 0;
  while (lineStart <= text.length) {
    const nl = text.indexOf("\n", lineStart);
    const lineEnd = nl === -1 ? text.length : nl;

    let pos = lineStart;
    while (pos < lineEnd) {
      const nextPlus = text.indexOf("++", pos);
      const nextIns = text.indexOf("<ins>", pos);

      const hasPlus = nextPlus !== -1 && nextPlus < lineEnd;
      const hasIns = nextIns !== -1 && nextIns < lineEnd;
      if (!hasPlus && !hasIns) break;

      const useIns = hasIns && (!hasPlus || nextIns < nextPlus);

      if (useIns) {
        if (isInComment(nextIns)) {
          pos = nextIns + 5;
          continue;
        }
        let searchFrom = nextIns + 5;
        let close = -1;
        while (searchFrom < lineEnd) {
          const candidate = text.indexOf("</ins>", searchFrom);
          if (candidate === -1 || candidate >= lineEnd) break;
          if (!isInComment(candidate)) {
            close = candidate;
            break;
          }
          searchFrom = candidate + 6;
        }
        if (close === -1) {
          pos = nextIns + 5;
          continue;
        }
        const end = close + 6;
        spans.push({
          kind: "addition",
          from: nextIns,
          to: end,
          innerFrom: nextIns + 5,
          innerTo: close,
          open: "<ins>",
          close: "</ins>",
        });
        pos = end;
      } else {
        if (isInComment(nextPlus)) {
          pos = nextPlus + 2;
          continue;
        }
        let searchFrom = nextPlus + 2;
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
        if (close === -1) {
          pos = nextPlus + 2;
          continue;
        }
        const end = close + 2;
        spans.push({
          kind: "addition",
          from: nextPlus,
          to: end,
          innerFrom: nextPlus + 2,
          innerTo: close,
          open: "++",
          close: "++",
        });
        pos = end;
      }
    }

    if (nl === -1) break;
    lineStart = nl + 1;
  }

  spans.sort((a, b) => a.from - b.from);
  return spans;
}

/**
 * Editable inner bounds of a span:
 * - For `++...++`, `<ins>...</ins>`, `%%...%%`: `[innerFrom, innerTo]`
 * - For `%%~~...~~%%`: `[from + 2, to - 2]` (anywhere inside `%%...%%`)
 */
export function getEditableBounds(span: TrackedSpan): { start: number; end: number } {
  if (span.kind === "deletion") {
    return { start: span.from + 2, end: span.to - 2 };
  }
  return { start: span.innerFrom, end: span.innerTo };
}

/**
 * Returns true if `pos` is strictly inside the delimiters of any `++...++`, `<ins>...</ins>`, or `%%...%%` span.
 */
export function isInsideTrackedMarkup(spans: TrackedSpan[], pos: number): boolean {
  for (const span of spans) {
    const { start, end } = getEditableBounds(span);
    if (pos >= start && pos <= end) {
      return true;
    }
    if (span.from > pos) break;
  }
  return false;
}

/**
 * Returns the span enclosing `pos` (strictly inside delimiters), or null.
 */
export function getEnclosingSpan(spans: TrackedSpan[], pos: number): TrackedSpan | null {
  for (const span of spans) {
    const { start, end } = getEditableBounds(span);
    if (pos >= start && pos <= end) {
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
