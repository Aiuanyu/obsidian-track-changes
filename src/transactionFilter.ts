import {
  ChangeSpec,
  EditorSelection,
  EditorState,
  Transaction,
  TransactionSpec,
} from "@codemirror/state";
import {
  findTrackedSpans,
  getEditableBounds,
  getEnclosingSpan,
  isInsideTrackedMarkup,
} from "./parser";
import {
  AdditionDelimiters,
  TrackChangesSettings,
  TrackedSpan,
  trackChangesIgnore,
} from "./types";

function wrapInsertion(
  text: string,
  delimiters: AdditionDelimiters
): { wrapped: string; cursorOffsetFromEnd: number } {
  if (text === "\n") {
    return { wrapped: "\n", cursorOffsetFromEnd: 0 };
  }
  if (text.includes("\n")) {
    const wrapped = text
      .split("\n")
      .map((line) => (line.length > 0 ? `${delimiters.open}${line}${delimiters.close}` : ""))
      .join("\n");
    return { wrapped, cursorOffsetFromEnd: 0 };
  }
  return {
    wrapped: `${delimiters.open}${text}${delimiters.close}`,
    cursorOffsetFromEnd: -delimiters.close.length,
  };
}

/**
 * Compute the deletion markup for deleting `docText.slice(fromA, toA)`.
 * - Text inside `++...++` or `<ins>...</ins>` is dropped cleanly (never existed in original).
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

  const deletedParts: string[] = [];
  let cursor = fromA;

  for (const span of spans) {
    if (span.to <= fromA) continue;
    if (span.from >= toA) break;

    if (cursor < span.from) {
      deletedParts.push(docText.slice(cursor, Math.min(toA, span.from)));
    }

    const overlapStart = Math.max(fromA, span.from);
    const overlapEnd = Math.min(toA, span.to);

    if (span.kind === "addition") {
      if (fromA <= span.innerFrom && toA >= span.innerTo) {
        expandFrom = Math.min(expandFrom, span.from);
        expandTo = Math.max(expandTo, span.to);
      }
    } else if (span.kind === "deletion") {
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
  getSettings: () => TrackChangesSettings,
  getDelimiters: () => AdditionDelimiters
) {
  return EditorState.transactionFilter.of((tr: Transaction): TransactionSpec | readonly TransactionSpec[] => {
    if (!tr.docChanged) return tr;
    if (tr.annotation(trackChangesIgnore)) return tr;
    if (!isTrackingActive(tr.startState)) return tr;
    if (tr.isUserEvent("undo") || tr.isUserEvent("redo")) return tr;
    if (tr.isUserEvent("input.type.compose")) return tr;

    const isInput = tr.isUserEvent("input");
    const isDelete = tr.isUserEvent("delete");
    const isDrop = tr.isUserEvent("move.drop");
    if (!isInput && !isDelete && !isDrop) return tr;

    const settings = getSettings();
    const delimiters = getDelimiters();
    const docText = tr.startState.doc.toString();
    const spans = findTrackedSpans(docText);

    const changes: Array<{ fromA: number; toA: number; inserted: string }> = [];
    tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
      changes.push({ fromA, toA, inserted: inserted.toString() });
    });

    if (changes.length === 0) return tr;

    // Handle single-caret boundary deletion cleanly (Backspace / Delete at delimiter edges).
    if (changes.length === 1 && settings.smartBoundaryDelete && isDelete) {
      const c = changes[0];
      if (c.inserted.length === 0 && c.toA - c.fromA === 1) {
        const isBackward = tr.isUserEvent("delete.backward");
        const isForward = tr.isUserEvent("delete.forward");

        for (const span of spans) {
          if (span.kind === "addition") {
            // Backspace right after `++...++|` or `<ins>...</ins>|`
            if (isBackward && c.toA <= span.to && c.fromA >= span.innerTo) {
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
            // Forward Delete right before `|++...++` or `|<ins>...</ins>`
            if (isForward && c.fromA >= span.from && c.toA <= span.innerFrom) {
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
          const { wrapped, cursorOffsetFromEnd } = wrapInsertion(inserted, delimiters);

          const hasPrevAdd =
            settings.mergeAdjacentMarkers &&
            wrapped.startsWith(delimiters.open) &&
            spans.some(
              (s) => s.kind === "addition" && s.to === fromA && s.open === delimiters.open
            );

          const hasNextAdd =
            settings.mergeAdjacentMarkers &&
            wrapped.endsWith(delimiters.close) &&
            spans.some(
              (s) => s.kind === "addition" && s.from === fromA && s.close === delimiters.close
            );

          let replaceFrom = fromA;
          let replaceTo = toA;
          let finalInsert = wrapped;

          if (hasPrevAdd) {
            replaceFrom -= delimiters.close.length;
            finalInsert = finalInsert.slice(delimiters.open.length);
          }
          if (hasNextAdd) {
            replaceTo += delimiters.open.length;
            finalInsert = finalInsert.slice(0, -delimiters.close.length);
          }

          newChanges.push({ from: replaceFrom, to: replaceTo, insert: finalInsert });
          const replacedLen = replaceTo - replaceFrom;
          if (i === changes.length - 1) {
            const endPos = replaceFrom + offsetDelta + finalInsert.length;
            finalCursor = hasNextAdd ? endPos : endPos + cursorOffsetFromEnd;
          }
          offsetDelta += finalInsert.length - replacedLen;
        }
      } else if (isPureDelete) {
        const enclosing = getEnclosingSpan(spans, fromA);
        if (enclosing && toA <= getEditableBounds(enclosing).end) {
          if (fromA === enclosing.innerFrom && toA === enclosing.innerTo) {
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
              replaceFrom -= 4;
              finalInsert = finalInsert.slice(4);
              mergedPrevFrom = prevSpan.from;
            }
            if (nextSpan) {
              replaceTo += 4;
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
        const enclosing = getEnclosingSpan(spans, fromA);
        if (enclosing && toA <= getEditableBounds(enclosing).end) {
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
          const { wrapped: insWrapped, cursorOffsetFromEnd } = wrapInsertion(inserted, delimiters);
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
