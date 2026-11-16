import { RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
} from "@codemirror/view";
import { findTrackedSpans } from "./parser";
import { TrackChangesSettings } from "./types";

const insMark = Decoration.mark({ class: "cm-tc-ins" });
const delMark = Decoration.mark({ class: "cm-tc-del" });
const markerMark = Decoration.mark({ class: "cm-tc-marker" });

function buildDecorations(view: EditorView, getSettings: () => TrackChangesSettings): DecorationSet {
  const settings = getSettings();
  if (!settings.showInlineDecorations) {
    return Decoration.none;
  }

  const builder = new RangeSetBuilder<Decoration>();
  const docText = view.state.doc.toString();
  const spans = findTrackedSpans(docText);

  const visibleFrom = view.visibleRanges.length > 0 ? view.visibleRanges[0].from : 0;
  const visibleTo =
    view.visibleRanges.length > 0
      ? view.visibleRanges[view.visibleRanges.length - 1].to
      : docText.length;

  for (const span of spans) {
    if (span.kind === "comment") continue;
    if (span.to < visibleFrom) continue;
    if (span.from > visibleTo) break;

    if (span.kind === "addition") {
      if (span.innerFrom > span.from) {
        builder.add(span.from, span.innerFrom, markerMark);
      }
      if (span.innerTo > span.innerFrom) {
        builder.add(span.innerFrom, span.innerTo, insMark);
      }
      if (span.to > span.innerTo) {
        builder.add(span.innerTo, span.to, markerMark);
      }
    } else if (span.kind === "deletion") {
      if (span.innerFrom > span.from) {
        builder.add(span.from, span.innerFrom, markerMark);
      }
      if (span.innerTo > span.innerFrom) {
        builder.add(span.innerFrom, span.innerTo, delMark);
      }
      if (span.to > span.innerTo) {
        builder.add(span.innerTo, span.to, markerMark);
      }
    }
  }

  return builder.finish();
}

export function createTrackChangesDecorations(getSettings: () => TrackChangesSettings) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildDecorations(view, getSettings);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = buildDecorations(update.view, getSettings);
        }
      }
    },
    {
      decorations: (v) => v.decorations,
    }
  );
}
