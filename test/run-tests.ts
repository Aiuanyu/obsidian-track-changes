import assert from "node:assert/strict";
import { EditorSelection, EditorState } from "@codemirror/state";
import { findTrackedSpans, isInsideTrackedMarkup } from "../src/parser";
import { createTrackChangesTransactionFilter } from "../src/transactionFilter";
import { DEFAULT_SETTINGS } from "../src/types";

function createState(doc: string, anchor: number, head = anchor) {
  return EditorState.create({
    doc,
    selection: EditorSelection.range(anchor, head),
    extensions: [
      createTrackChangesTransactionFilter(
        () => true,
        () => ({ ...DEFAULT_SETTINGS })
      ),
    ],
  });
}

// 1. Typing outside wraps in ++...++ and places cursor inside
{
  let s = createState("hello ", 6);
  s = s.update({
    changes: { from: 6, to: 6, insert: "w" },
    userEvent: "input.type",
  }).state;
  assert.equal(s.doc.toString(), "hello ++w++");
  assert.equal(s.selection.main.head, 9); // between w and ++

  // Typing next char 'o' is inside ++...++, so it becomes ++wo++
  s = s.update({
    changes: { from: 9, to: 9, insert: "o" },
    userEvent: "input.type",
  }).state;
  assert.equal(s.doc.toString(), "hello ++wo++");
  assert.equal(s.selection.main.head, 10);
}

// 2. Typing inside existing %%...%% does NOT wrap in ++
{
  let s = createState("hello %%note%%", 12);
  s = s.update({
    changes: { from: 12, to: 12, insert: "!" },
    userEvent: "input.type",
  }).state;
  assert.equal(s.doc.toString(), "hello %%note!%%");
}

// 3. Backspace outside wraps in %%~~...~~%% and merges consecutive backspaces
{
  let s = createState("abc", 3);
  s = s.update({
    changes: { from: 2, to: 3, insert: "" },
    userEvent: "delete.backward",
  }).state;
  assert.equal(s.doc.toString(), "ab%%~~c~~%%");
  assert.equal(s.selection.main.head, 2);

  s = s.update({
    changes: { from: 1, to: 2, insert: "" },
    userEvent: "delete.backward",
  }).state;
  assert.equal(s.doc.toString(), "a%%~~bc~~%%");
  assert.equal(s.selection.main.head, 1);
}

// 4. Forward delete outside wraps in %%~~...~~%% and merges consecutive deletes
{
  let s = createState("abc", 0);
  s = s.update({
    changes: { from: 0, to: 1, insert: "" },
    userEvent: "delete.forward",
  }).state;
  assert.equal(s.doc.toString(), "%%~~a~~%%bc");
  assert.equal(s.selection.main.head, 9);

  s = s.update({
    changes: { from: 9, to: 10, insert: "" },
    userEvent: "delete.forward",
  }).state;
  assert.equal(s.doc.toString(), "%%~~ab~~%%c");
  assert.equal(s.selection.main.head, 10);
}

// 5. Deleting inside existing ++...++ removes directly and cleans empty ++++
{
  let s = createState("hello ++x++", 9);
  s = s.update({
    changes: { from: 8, to: 9, insert: "" },
    userEvent: "delete.backward",
  }).state;
  assert.equal(s.doc.toString(), "hello ");
  assert.equal(s.selection.main.head, 6);
}

// 6. Deleting inside existing %%~~...~~%% does NOT double-wrap
{
  let s = createState("%%~~abc~~%%", 7);
  s = s.update({
    changes: { from: 6, to: 7, insert: "" },
    userEvent: "delete.backward",
  }).state;
  assert.equal(s.doc.toString(), "%%~~ab~~%%");
}

// 7. Replacing selected original text with new text -> %%~~old~~%%++new++
{
  let s = createState("hello world", 6, 11);
  s = s.update({
    changes: { from: 6, to: 11, insert: "obs" },
    userEvent: "input.type",
  }).state;
  assert.equal(s.doc.toString(), "hello %%~~world~~%%++obs++");
  assert.equal(s.selection.main.head, "hello %%~~world~~%%++obs".length);
}

// 8. Smart boundary delete: Backspace right after `++abc++|` deletes `c` inside, not `+`
{
  let s = createState("++abc++", 7);
  s = s.update({
    changes: { from: 6, to: 7, insert: "" },
    userEvent: "delete.backward",
  }).state;
  assert.equal(s.doc.toString(), "++ab++");
  assert.equal(s.selection.main.head, 4);
}

// 9. Smart boundary delete: Backspace right after `%%~~abc~~%%|` skips over without corrupting
{
  let s = createState("hi %%~~abc~~%%", 14);
  s = s.update({
    changes: { from: 13, to: 14, insert: "" },
    userEvent: "delete.backward",
  }).state;
  assert.equal(s.doc.toString(), "hi %%~~abc~~%%");
  assert.equal(s.selection.main.head, 3);
}

// 10. Parser check: C++ in separate lines should not pair across paragraphs
{
  const spans = findTrackedSpans("Line 1 C++\nLine 2 C++");
  assert.equal(spans.length, 0);
  assert.equal(isInsideTrackedMarkup(spans, 12), false);
}

console.log("All 10 Track Changes test suites passed!");
