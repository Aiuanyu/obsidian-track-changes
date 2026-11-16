import { Annotation } from "@codemirror/state";

export type SpanKind = "addition" | "deletion" | "comment";
export type AdditionSyntaxMode = "auto" | "plus" | "ins";

export interface AdditionDelimiters {
  open: string;
  close: string;
}

export interface TrackedSpan {
  kind: SpanKind;
  /** Start offset of the opening delimiter (`++`, `<ins>`, or `%%`). */
  from: number;
  /** End offset after the closing delimiter (`++`, `</ins>`, or `%%`). */
  to: number;
  /** Start offset of the inner text (`from + 2` for ++/%%, `from + 5` for <ins>, `from + 4` for %%~~). */
  innerFrom: number;
  /** End offset of the inner text (`to - 2` for ++/%%, `to - 6` for </ins>, `to - 4` for ~~%%). */
  innerTo: number;
  /** Opening delimiter string for addition spans (`++` or `<ins>`). */
  open?: string;
  /** Closing delimiter string for addition spans (`++` or `</ins>`). */
  close?: string;
}

export interface TrackChangesSettings {
  /** Addition syntax mode: auto-detect Extended Markdown Syntax (`++`) or fallback to `<ins>`. */
  additionSyntax: AdditionSyntaxMode;
  /** Whether to merge adjacent ++a++++b++, <ins>a</ins><ins>b</ins>, or %%~~a~~%%%%~~b~~%% markers. */
  mergeAdjacentMarkers: boolean;
  /** Whether to render color decorations in Live Preview / Source Mode. */
  showInlineDecorations: boolean;
  /** Whether to skip delimiter markers cleanly on Backspace / Delete at boundaries. */
  smartBoundaryDelete: boolean;
}

export const DEFAULT_SETTINGS: TrackChangesSettings = {
  additionSyntax: "auto",
  mergeAdjacentMarkers: true,
  showInlineDecorations: true,
  smartBoundaryDelete: true,
};

export const PLUS_DELIMITERS: AdditionDelimiters = { open: "++", close: "++" };
export const INS_DELIMITERS: AdditionDelimiters = { open: "<ins>", close: "</ins>" };

/**
 * Transaction annotation used to bypass the Track Changes filter
 * (e.g. for Accept/Reject actions or IME composition commit).
 */
export const trackChangesIgnore = Annotation.define<boolean>();
