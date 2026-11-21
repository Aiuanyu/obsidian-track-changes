import { EditorState, RangeSetBuilder, StateField } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { editorLivePreviewField } from "obsidian";
import { findTrackedSpans } from "./parser";
import { refreshDecorationsEffect, TrackChangesSettings } from "./types";

const insMark = Decoration.mark({ class: "cm-tc-ins" });
const delMark = Decoration.mark({ class: "cm-tc-del" });
const markerMark = Decoration.mark({ class: "cm-tc-marker" });

class DeletionAnchorWidget extends WidgetType {
  constructor(
    readonly from: number,
    readonly to: number,
    readonly previewText: string
  ) {
    super();
  }

  eq(other: DeletionAnchorWidget): boolean {
    return (
      other.from === this.from &&
      other.to === this.to &&
      other.previewText === this.previewText
    );
  }

  toDOM(): HTMLElement {
    const el = document.createElement("span");
    el.className = "cm-tc-del-anchor";
    el.dataset.tcFrom = String(this.from);
    el.dataset.tcTo = String(this.to);
    el.setAttribute("aria-label", `已刪除文字：${this.previewText}`);
    el.title = `已刪除：${this.previewText}（點擊展開編輯）`;

    const bar = document.createElement("span");
    bar.className = "cm-tc-del-anchor-bar";
    el.appendChild(bar);
    return el;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

function buildDecorations(
  state: EditorState,
  getSettings: () => TrackChangesSettings
): DecorationSet {
  const settings = getSettings();
  if (!settings.showInlineDecorations) {
    return Decoration.none;
  }

  const builder = new RangeSetBuilder<Decoration>();
  const docText = state.doc.toString();
  const spans = findTrackedSpans(docText);

  const isLivePreview = state.field(editorLivePreviewField, false) ?? false;
  const useSidenote = settings.deletionDisplayMode === "sidenote";
  const sel = state.selection.main;

  for (const span of spans) {
    if (span.kind === "comment") continue;

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
      const isCursorTouching = sel.to >= span.from && sel.from <= span.to;
      if (useSidenote && isLivePreview && !isCursorTouching) {
        const rawInner = docText.slice(span.innerFrom, span.innerTo).replace(/\s+/g, " ").trim();
        const preview = rawInner.length > 40 ? `${rawInner.slice(0, 40)}…` : rawInner;
        builder.add(
          span.from,
          span.to,
          Decoration.replace({
            widget: new DeletionAnchorWidget(span.from, span.to, preview),
          })
        );
      } else {
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
  }

  return builder.finish();
}

export function createTrackChangesDecorations(getSettings: () => TrackChangesSettings) {
  return StateField.define<DecorationSet>({
    create(state) {
      return buildDecorations(state, getSettings);
    },
    update(value, tr) {
      const livePreviewChanged =
        (tr.state.field(editorLivePreviewField, false) ?? false) !==
        (tr.startState.field(editorLivePreviewField, false) ?? false);
      const settingsRefreshed = tr.effects.some((e) => e.is(refreshDecorationsEffect));

      if (tr.docChanged || tr.selection || livePreviewChanged || settingsRefreshed || tr.reconfigured) {
        return buildDecorations(tr.state, getSettings);
      }
      return value;
    },
    provide: (field) => EditorView.decorations.from(field),
  });
}
