import assert from "node:assert/strict";
import { EditorSelection, EditorState } from "@codemirror/state";
import { findTrackedSpans, isInsideTrackedMarkup } from "../src/parser";
import { createTrackChangesTransactionFilter } from "../src/transactionFilter";
import {
  AdditionDelimiters,
  DEFAULT_SETTINGS,
  INS_DELIMITERS,
  PLUS_DELIMITERS,
} from "../src/types";

function createState(
  doc: string,
  anchor: number,
  head = anchor,
  delimiters: AdditionDelimiters = PLUS_DELIMITERS
) {
  return EditorState.create({
    doc,
    selection: EditorSelection.range(anchor, head),
    extensions: [
      createTrackChangesTransactionFilter(
        () => true,
        () => ({ ...DEFAULT_SETTINGS }),
        () => delimiters
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

// 11. Fallback <ins>...</ins> mode: typing, continuing inside, smart boundary delete, and cleanup
{
  let s = createState("hello ", 6, 6, INS_DELIMITERS);
  s = s.update({
    changes: { from: 6, to: 6, insert: "w" },
    userEvent: "input.type",
  }).state;
  assert.equal(s.doc.toString(), "hello <ins>w</ins>");
  assert.equal(s.selection.main.head, 12); // right before </ins>

  s = s.update({
    changes: { from: 12, to: 12, insert: "o" },
    userEvent: "input.type",
  }).state;
  assert.equal(s.doc.toString(), "hello <ins>wo</ins>");

  // Backspace right after `hello <ins>wo</ins>|` deletes `o`, not `>`
  s = EditorState.create({
    doc: "hello <ins>wo</ins>",
    selection: EditorSelection.cursor(19),
    extensions: [
      createTrackChangesTransactionFilter(
        () => true,
        () => ({ ...DEFAULT_SETTINGS }),
        () => INS_DELIMITERS
      ),
    ],
  });
  s = s.update({
    changes: { from: 18, to: 19, insert: "" },
    userEvent: "delete.backward",
  }).state;
  assert.equal(s.doc.toString(), "hello <ins>w</ins>");

  // Deleting last char inside <ins>w</ins> cleans up empty <ins></ins>
  s = s.update({
    changes: { from: 11, to: 12, insert: "" },
    userEvent: "delete.backward",
  }).state;
  assert.equal(s.doc.toString(), "hello ");
}

// 12. Forward delete right before closing `++` jumps outside and deletes next char outside
{
  let s = createState("hello ++w++world", 9); // "hello ++w|++world"
  s = s.update({
    changes: { from: 9, to: 10, insert: "" },
    userEvent: "delete.forward",
  }).state;
  assert.equal(s.doc.toString(), "hello ++w++%%~~w~~%%orld");
  assert.equal(s.selection.main.head, 20);

  // Subsequent forward delete merges into the deletion span
  s = s.update({
    changes: { from: 20, to: 21, insert: "" },
    userEvent: "delete.forward",
  }).state;
  assert.equal(s.doc.toString(), "hello ++w++%%~~wo~~%%rld");
  assert.equal(s.selection.main.head, 21);
}

// 13. Forward delete right before closing `++` at EOF jumps outside without deleting `+`
{
  let s = createState("hello ++w++", 9);
  s = s.update({
    changes: { from: 9, to: 10, insert: "" },
    userEvent: "delete.forward",
  }).state;
  assert.equal(s.doc.toString(), "hello ++w++");
  assert.equal(s.selection.main.head, 11);
}

// 14. Forward delete right before closing `</ins>` jumps outside and deletes next char outside
{
  let s = createState("hello <ins>w</ins>world", 12, 12, INS_DELIMITERS);
  s = s.update({
    changes: { from: 12, to: 13, insert: "" },
    userEvent: "delete.forward",
  }).state;
  assert.equal(s.doc.toString(), "hello <ins>w</ins>%%~~w~~%%orld");
  assert.equal(s.selection.main.head, 27);
}

// 15. Forward delete right before closing `++` followed by `%%~~x~~%%` jumps over without corrupting
{
  let s = createState("hello ++w++%%~~x~~%%orld", 9);
  s = s.update({
    changes: { from: 9, to: 10, insert: "" },
    userEvent: "delete.forward",
  }).state;
  assert.equal(s.doc.toString(), "hello ++w++%%~~x~~%%orld");
  assert.equal(s.selection.main.head, 20);
}

console.log("All 15 Track Changes test suites passed!");
