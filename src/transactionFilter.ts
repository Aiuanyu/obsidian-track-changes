import {
  ChangeSpec,
  EditorSelection,
  EditorState,
  Transaction,
  TransactionSpec,
} from "@codemirror/state";
import {
  findTrackedSpans,
  getEnclosingSpan,
  isInsideTrackedMarkup,
} from "./parser";
import { TrackChangesSettings, TrackedSpan, trackChangesIgnore } from "./types";

function wrapInsertion(text: string): { wrapped: string; cursorOffsetFromEnd: number } {
  if (text === "\n") {
    return { wrapped: "\n", cursorOffsetFromEnd: 0 };
  }
  if (text.includes("\n")) {
    const wrapped = text
      .split("\n")
      .map((line) => (line.length > 0 ? `++${line}++` : ""))
      .join("\n");
    return { wrapped, cursorOffsetFromEnd: 0 };
  }
  return { wrapped: `++${text}++`, cursorOffsetFromEnd: -2 };
}

/**
 * Compute the deletion markup for deleting `docText.slice(fromA, toA)`.
 * - Text inside `++...++` is dropped cleanly (never existed in original).
 * - Text inside `%%~~...~~%%` keeps its deleted content.
 * - Normal text is wrapped in `%%~~...~~%%`.
 */
function buildDeletionMarkup(
  docText: string,
  spans: TrackedSpan[],
  fromA: number,
  toA: number
): { markup: string; expandFrom: number; expandTo: number } {
  let expandFrom = fromA;
  let expandTo = toA;

  // Collect raw deleted chunks (either original text or already-deleted text).
  const deletedParts: string[] = [];
  let cursor = fromA;

  for (const span of spans) {
    if (span.to <= fromA) continue;
    if (span.from >= toA) break;

    // Text before this span
    if (cursor < span.from) {
      deletedParts.push(docText.slice(cursor, Math.min(toA, span.from)));
    }

    const overlapStart = Math.max(fromA, span.from);
    const overlapEnd = Math.min(toA, span.to);

    if (span.kind === "addition") {
      // Addition text is simply dropped. If selection starts/ends inside delimiters,
      // expand to clean up stray `+` if the entire span is consumed.
      if (fromA <= span.innerFrom && toA >= span.innerTo) {
        expandFrom = Math.min(expandFrom, span.from);
        expandTo = Math.max(expandTo, span.to);
      }
    } else if (span.kind === "deletion") {
      // Preserve inner deleted text without double-wrapping %%~~.
      const innerStart = Math.max(overlapStart, span.innerFrom);
      const innerEnd = Math.min(overlapEnd, span.innerTo);
      if (innerEnd > innerStart) {
        deletedParts.push(docText.slice(innerStart, innerEnd));
      }
      if (fromA <= span.innerFrom && toA >= span.innerTo) {
        expandFrom = Math.min(expandFrom, span.from);
        expandTo = Math.max(expandTo, span.to);
      }
    } else {
      // Comment span: if partially/fully selected, keep as deleted text or skip.
      const innerStart = Math.max(overlapStart, span.innerFrom);
      const innerEnd = Math.min(overlapEnd, span.innerTo);
      if (innerEnd > innerStart) {
        deletedParts.push(docText.slice(innerStart, innerEnd));
      }
    }

    cursor = Math.max(cursor, overlapEnd);
  }

  if (cursor < toA) {
    deletedParts.push(docText.slice(cursor, toA));
  }

  const combined = deletedParts.join("");
  if (combined.length === 0) {
    return { markup: "", expandFrom, expandTo };
  }
  return { markup: `%%~~${combined}~~%%`, expandFrom, expandTo };
}

export function createTrackChangesTransactionFilter(
  isTrackingActive: (state: EditorState) => boolean,
  getSettings: () => TrackChangesSettings
) {
  return EditorState.transactionFilter.of((tr: Transaction): TransactionSpec | readonly TransactionSpec[] => {
    if (!tr.docChanged) return tr;
    if (tr.annotation(trackChangesIgnore)) return tr;
    if (!isTrackingActive(tr.startState)) return tr;
    if (tr.isUserEvent("undo") || tr.isUserEvent("redo")) return tr;
    // IME composition is handled on compositionend by imeHandler.ts so we don't break Chromium IME.
    if (tr.isUserEvent("input.type.compose")) return tr;

    const isInput = tr.isUserEvent("input");
    const isDelete = tr.isUserEvent("delete");
    const isDrop = tr.isUserEvent("move.drop");
    if (!isInput && !isDelete && !isDrop) return tr;

    const settings = getSettings();
    const docText = tr.startState.doc.toString();
    const spans = findTrackedSpans(docText);

    const changes: Array<{ fromA: number; toA: number; inserted: string }> = [];
    tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
      changes.push({ fromA, toA, inserted: inserted.toString() });
    });

    if (changes.length === 0) return tr;

    // Handle single-caret boundary deletion cleanly (Backspace / Delete at ++ or %%~~...~~%% edges).
    if (changes.length === 1 && settings.smartBoundaryDelete && isDelete) {
      const c = changes[0];
      if (c.inserted.length === 0 && c.toA - c.fromA === 1) {
        const isBackward = tr.isUserEvent("delete.backward");
        const isForward = tr.isUserEvent("delete.forward");

        for (const span of spans) {
          if (span.kind === "addition") {
            // Backspace right after `++...++|`
            if (isBackward && c.toA === span.to && c.fromA >= span.to - 2) {
              if (span.innerTo - span.innerFrom <= 1) {
                return {
                  changes: { from: span.from, to: span.to, insert: "" },
                  selection: EditorSelection.cursor(span.from),
                  annotations: trackChangesIgnore.of(true),
                };
              }
              return {
                changes: { from: span.innerTo - 1, to: span.innerTo, insert: "" },
                selection: EditorSelection.cursor(span.innerTo - 1),
                annotations: trackChangesIgnore.of(true),
              };
            }
            // Forward Delete right before `|++...++`
            if (isForward && c.fromA === span.from && c.toA <= span.from + 2) {
              if (span.innerTo - span.innerFrom <= 1) {
                return {
                  changes: { from: span.from, to: span.to, insert: "" },
                  selection: EditorSelection.cursor(span.from),
                  annotations: trackChangesIgnore.of(true),
                };
              }
              return {
                changes: { from: span.innerFrom, to: span.innerFrom + 1, insert: "" },
                selection: EditorSelection.cursor(span.innerFrom),
                annotations: trackChangesIgnore.of(true),
              };
            }
          } else {
            // Deletion or Comment (`%%~~...~~%%` or `%%...%%`): skip over delimiters instead of breaking them.
            if (isBackward && c.toA === span.to && c.fromA >= span.to - 2) {
              return {
                selection: EditorSelection.cursor(span.from),
                annotations: trackChangesIgnore.of(true),
              };
            }
            if (isForward && c.fromA === span.from && c.toA <= span.from + 2) {
              return {
                selection: EditorSelection.cursor(span.to),
                annotations: trackChangesIgnore.of(true),
              };
            }
            if (span.kind === "deletion") {
              if (isBackward && c.fromA >= span.from && c.toA <= span.innerFrom) {
                return {
                  selection: EditorSelection.cursor(span.from),
                  annotations: trackChangesIgnore.of(true),
                };
              }
              if (isForward && c.fromA >= span.innerTo && c.toA <= span.to) {
                return {
                  selection: EditorSelection.cursor(span.to),
                  annotations: trackChangesIgnore.of(true),
                };
              }
            }
          }
        }
      }
    }

    const newChanges: ChangeSpec[] = [];
    let finalCursor: number | null = null;
    // Track cumulative offset delta so we can compute finalCursor accurately for single-change edits.
    let offsetDelta = 0;

    for (let i = 0; i < changes.length; i++) {
      const { fromA, toA, inserted } = changes[i];
      const isPureInsert = fromA === toA && inserted.length > 0;
      const isPureDelete = fromA < toA && inserted.length === 0;

      if (isPureInsert) {
        if (isInsideTrackedMarkup(spans, fromA)) {
          newChanges.push({ from: fromA, to: toA, insert: inserted });
          if (i === changes.length - 1) {
            finalCursor = fromA + offsetDelta + inserted.length;
          }
          offsetDelta += inserted.length;
        } else {
          const { wrapped, cursorOffsetFromEnd } = wrapInsertion(inserted);

          // Merge with adjacent `++` if present right before or right after.
          const hasPrevPlus =
            settings.mergeAdjacentMarkers &&
            wrapped.startsWith("++") &&
            fromA >= 2 &&
            docText.slice(fromA - 2, fromA) === "++" &&
            spans.some((s) => s.kind === "addition" && s.to === fromA);

          const hasNextPlus =
            settings.mergeAdjacentMarkers &&
            wrapped.endsWith("++") &&
            fromA + 2 <= docText.length &&
            docText.slice(fromA, fromA + 2) === "++" &&
            spans.some((s) => s.kind === "addition" && s.from === fromA);

          let replaceFrom = fromA;
          let replaceTo = toA;
          let finalInsert = wrapped;

          if (hasPrevPlus) {
            replaceFrom -= 2;
            finalInsert = finalInsert.slice(2);
          }
          if (hasNextPlus) {
            replaceTo += 2;
            finalInsert = finalInsert.slice(0, -2);
          }

          newChanges.push({ from: replaceFrom, to: replaceTo, insert: finalInsert });
          const replacedLen = replaceTo - replaceFrom;
          if (i === changes.length - 1) {
            const endPos = replaceFrom + offsetDelta + finalInsert.length;
            finalCursor = hasNextPlus ? endPos : endPos + cursorOffsetFromEnd;
          }
          offsetDelta += finalInsert.length - replacedLen;
        }
      } else if (isPureDelete) {
        const enclosing = getEnclosingSpan(spans, fromA);
        if (enclosing && toA <= enclosing.to - 2) {
          // Deleting strictly inside an existing `++...++` or `%%...%%` span.
          if (fromA === enclosing.innerFrom && toA === enclosing.innerTo) {
            // Entire inner content deleted -> remove the empty wrapper too.
            newChanges.push({ from: enclosing.from, to: enclosing.to, insert: "" });
            if (i === changes.length - 1) {
              finalCursor = enclosing.from + offsetDelta;
            }
            offsetDelta -= enclosing.to - enclosing.from;
          } else {
            newChanges.push({ from: fromA, to: toA, insert: "" });
            if (i === changes.length - 1) {
              finalCursor = fromA + offsetDelta;
            }
            offsetDelta -= toA - fromA;
          }
        } else {
          // Deleting outside or across spans -> mark deleted original text as %%~~...~~%%.
          const { markup, expandFrom, expandTo } = buildDeletionMarkup(
            docText,
            spans,
            fromA,
            toA
          );

          let replaceFrom = expandFrom;
          let replaceTo = expandTo;
          let finalInsert = markup;

          let mergedPrevFrom: number | null = null;

          if (settings.mergeAdjacentMarkers && finalInsert.startsWith("%%~~") && finalInsert.endsWith("~~%%")) {
            const prevSpan = spans.find((s) => s.kind === "deletion" && s.to === replaceFrom);
            const nextSpan = spans.find((s) => s.kind === "deletion" && s.from === replaceTo);

            if (prevSpan) {
              replaceFrom -= 4; // strip previous `~~%%`
              finalInsert = finalInsert.slice(4);
              mergedPrevFrom = prevSpan.from;
            }
            if (nextSpan) {
              replaceTo += 4; // strip next `%%~~`
              finalInsert = finalInsert.slice(0, -4);
            }
          }

          newChanges.push({ from: replaceFrom, to: replaceTo, insert: finalInsert });
          const replacedLen = replaceTo - replaceFrom;

          if (i === changes.length - 1) {
            const isBackward = tr.isUserEvent("delete.backward");
            if (isBackward) {
              finalCursor =
                mergedPrevFrom !== null
                  ? mergedPrevFrom + offsetDelta
                  : replaceFrom + offsetDelta;
            } else {
              finalCursor = replaceFrom + offsetDelta + finalInsert.length;
            }
          }
          offsetDelta += finalInsert.length - replacedLen;
        }
      } else {
        // Replacement (fromA < toA && inserted.length > 0)
        const enclosing = getEnclosingSpan(spans, fromA);
        if (enclosing && toA <= enclosing.to - 2) {
          newChanges.push({ from: fromA, to: toA, insert: inserted });
          if (i === changes.length - 1) {
            finalCursor = fromA + offsetDelta + inserted.length;
          }
          offsetDelta += inserted.length - (toA - fromA);
        } else {
          const { markup: delMarkup, expandFrom, expandTo } = buildDeletionMarkup(
            docText,
            spans,
            fromA,
            toA
          );
          const { wrapped: insWrapped, cursorOffsetFromEnd } = wrapInsertion(inserted);
          const combined = delMarkup + insWrapped;

          newChanges.push({ from: expandFrom, to: expandTo, insert: combined });
          if (i === changes.length - 1) {
            finalCursor = expandFrom + offsetDelta + combined.length + cursorOffsetFromEnd;
          }
          offsetDelta += combined.length - (expandTo - expandFrom);
        }
      }
    }

    const resultSpec: TransactionSpec = {
      changes: newChanges,
      annotations: trackChangesIgnore.of(true),
      scrollIntoView: tr.scrollIntoView,
    };

    if (finalCursor !== null) {
      resultSpec.selection = EditorSelection.cursor(Math.max(0, finalCursor));
    }

    return resultSpec;
  });
}
