import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import {
  findTrackedSpans,
  getEditableBounds,
  getEnclosingSpan,
  isInsideTrackedMarkup,
} from "./parser";
import { AdditionDelimiters, trackChangesIgnore } from "./types";

interface PendingCompose {
  from: number;
  deletedMarkup: string;
}

export function createImeHandler(
  isTrackingActive: (state: EditorState) => boolean,
  getDelimiters: () => AdditionDelimiters
) {
  return ViewPlugin.fromClass(
    class {
      private pending: PendingCompose | null = null;
      private view: EditorView;

      constructor(view: EditorView) {
        this.view = view;
      }

      update(_update: ViewUpdate) {
        // No-op; composition lifecycle is handled via DOM event handlers.
      }

      onCompositionStart() {
        if (!isTrackingActive(this.view.state)) {
          this.pending = null;
          return;
        }

        const sel = this.view.state.selection.main;
        const docText = this.view.state.doc.toString();
        const spans = findTrackedSpans(docText);

        if (sel.empty) {
          if (isInsideTrackedMarkup(spans, sel.from)) {
            this.pending = null;
          } else {
            this.pending = { from: sel.from, deletedMarkup: "" };
          }
          return;
        }

        const enclosing = getEnclosingSpan(spans, sel.from);
        if (enclosing && sel.to <= getEditableBounds(enclosing).end) {
          this.pending = null;
          return;
        }

        const deletedText = this.view.state.sliceDoc(sel.from, sel.to);
        this.pending = {
          from: sel.from,
          deletedMarkup: deletedText.length > 0 ? `%%~~${deletedText}~~%%` : "",
        };
      }

      onCompositionEnd() {
        const pending = this.pending;
        this.pending = null;
        if (!pending) return;

        window.setTimeout(() => {
          if (!isTrackingActive(this.view.state)) return;

          const head = this.view.state.selection.main.head;
          if (head < pending.from) return;

          const composedText = this.view.state.sliceDoc(pending.from, head);
          if (composedText.length === 0 && pending.deletedMarkup.length === 0) {
            return;
          }

          const delimiters = getDelimiters();
          const wrappedIns =
            composedText.length > 0 ? `${delimiters.open}${composedText}${delimiters.close}` : "";
          const replacement = pending.deletedMarkup + wrappedIns;
          const cursorPos =
            composedText.length > 0
              ? pending.from + replacement.length - delimiters.close.length
              : pending.from + replacement.length;

          this.view.dispatch({
            changes: { from: pending.from, to: head, insert: replacement },
            selection: EditorSelection.cursor(cursorPos),
            annotations: trackChangesIgnore.of(true),
          });
        }, 0);
      }
    },
    {
      eventHandlers: {
        compositionstart(_event, _view) {
          this.onCompositionStart();
        },
        compositionend(_event, _view) {
          this.onCompositionEnd();
        },
      },
    }
  );
}
