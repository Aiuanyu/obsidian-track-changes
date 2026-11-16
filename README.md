# Track Changes (追蹤修訂) for Obsidian

Track Changes mode for Obsidian **Live Preview** and **Source Mode** using `++additions++` and `%%~~deletions~~%%`.

## Features

- **Mode-aware**: Active only in editing modes (Live Preview and Source Mode), automatically paused in Reading View.
- **Floating Indicator**: Prominent **「追蹤修訂中」** floating pill with quick navigation (`↑` / `↓`), accept (`✓`), reject (`✕`), and close controls.
- **Additions (`++...++`)**: Typed or pasted text is wrapped with `++...++` (unless already inside `++...++` or `%%...%%`).
- **Deletions (`%%~~...~~%%`)**: Deleted text is preserved and wrapped with `%%~~...~~%%` (unless deleting inside `++...++` or `%%...%%`).
- **IME Safe**: Defers wrapping during CJK / IME composition (`input.type.compose`) until `compositionend`, preserving candidate windows.
- **Smart Merging & Boundary Protection**: Merges consecutive additions/deletions and protects delimiters from accidental corruption on Backspace/Delete.
- **Review Commands**: Accept/Reject change at cursor, Accept/Reject all changes, Jump to next/previous change.

## Development

```bash
npm install
npm run build
```
