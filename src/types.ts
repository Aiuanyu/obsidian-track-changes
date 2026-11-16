import { Annotation } from "@codemirror/state";

export type SpanKind = "addition" | "deletion" | "comment";

export interface TrackedSpan {
  kind: SpanKind;
  /** Start offset of the opening delimiter (`++` or `%%`). */
  from: number;
  /** End offset after the closing delimiter (`++` or `%%`). */
  to: number;
  /** Start offset of the inner text (`from + 2` for ++/%%, `from + 4` for %%~~). */
  innerFrom: number;
  /** End offset of the inner text (`to - 2` for ++/%%, `to - 4` for ~~%%). */
  innerTo: number;
}

export interface TrackChangesSettings {
  /** Whether to merge adjacent ++a++++b++ or %%~~a~~%%%%~~b~~%% markers automatically. */
  mergeAdjacentMarkers: boolean;
  /** Whether to render color decorations in Live Preview / Source Mode. */
  showInlineDecorations: boolean;
  /** Whether to skip delimiter markers cleanly on Backspace / Delete at boundaries. */
  smartBoundaryDelete: boolean;
}

export const DEFAULT_SETTINGS: TrackChangesSettings = {
  mergeAdjacentMarkers: true,
  showInlineDecorations: true,
  smartBoundaryDelete: true,
};

/**
 * Transaction annotation used to bypass the Track Changes filter
 * (e.g. for Accept/Reject actions or IME composition commit).
 */
export const trackChangesIgnore = Annotation.define<boolean>();
