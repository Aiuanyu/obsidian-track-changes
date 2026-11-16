import { ChangeSpec, EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { findActionableSpanAt, findTrackedSpans } from "./parser";
import { TrackedSpan, trackChangesIgnore } from "./types";

function getReplacementForSpan(docText: string, span: TrackedSpan, action: "accept" | "reject"): string {
  if (action === "accept") {
    return span.kind === "addition" ? docText.slice(span.innerFrom, span.innerTo) : "";
  }
  return span.kind === "deletion" ? docText.slice(span.innerFrom, span.innerTo) : "";
}

export function applyActionAtCursor(view: EditorView, action: "accept" | "reject"): boolean {
  const docText = view.state.doc.toString();
  const spans = findTrackedSpans(docText);
  const head = view.state.selection.main.head;
  const span = findActionableSpanAt(spans, head);
  if (!span) return false;

  const replacement = getReplacementForSpan(docText, span, action);
  view.dispatch({
    changes: { from: span.from, to: span.to, insert: replacement },
    selection: EditorSelection.cursor(span.from + replacement.length),
    annotations: trackChangesIgnore.of(true),
    scrollIntoView: true,
  });
  return true;
}

export function applyActionToAll(view: EditorView, action: "accept" | "reject"): number {
  const docText = view.state.doc.toString();
  const spans = findTrackedSpans(docText).filter((s) => s.kind !== "comment");
  if (spans.length === 0) return 0;

  const changes: ChangeSpec[] = spans.map((span) => ({
    from: span.from,
    to: span.to,
    insert: getReplacementForSpan(docText, span, action),
  }));

  view.dispatch({
    changes,
    annotations: trackChangesIgnore.of(true),
  });
  return spans.length;
}

export function jumpToChange(view: EditorView, direction: "next" | "prev"): boolean {
  const docText = view.state.doc.toString();
  const spans = findTrackedSpans(docText).filter((s) => s.kind !== "comment");
  if (spans.length === 0) return false;

  const head = view.state.selection.main.head;
  let target: TrackedSpan | undefined;

  if (direction === "next") {
    target = spans.find((s) => s.from > head) ?? spans[0];
  } else {
    for (let i = spans.length - 1; i >= 0; i--) {
      if (spans[i].to < head) {
        target = spans[i];
        break;
      }
    }
    if (!target) {
      target = spans[spans.length - 1];
    }
  }

  view.dispatch({
    selection: EditorSelection.cursor(target.innerFrom),
    scrollIntoView: true,
  });
  return true;
}
