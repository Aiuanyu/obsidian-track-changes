# Simple Track Changes

Track Changes mode for Obsidian **Live Preview** and **Source Mode** using `++additions++` (or `<ins>additions</ins>` fallback) and `%%~~deletions~~%%`.

## Addition Syntax & Dependency

- **`++...++` syntax** depends on [Extended Markdown Syntax](https://github.com/kotaindah55/extended-markdown-syntax) (`extended-markdown-syntax`).
- **Automatic `<ins>` fallback**: When Extended Markdown Syntax is not installed or enabled, Track Changes automatically falls back to native HTML `<ins>...</ins>` tags so additions still render properly in Live Preview and Reading View.
- You can also override this behavior in plugin settings (**Auto**, **Force `++...++`**, or **Force `<ins>...</ins>`**). Both `++...++` and `<ins>...</ins>` are recognized uniformly for decorations, boundary protection, and Accept/Reject actions.

## Features

- **Mode-aware**: Active only in editing modes (Live Preview and Source Mode), automatically paused in Reading View.
- **Floating Indicator**: Prominent **「追蹤修訂中」** floating pill with quick navigation (`↑` / `↓`), accept (`✓`), reject (`✕`), and close controls.
- **Additions (`++...++` / `<ins>...</ins>`)**: Typed or pasted text is wrapped automatically (unless already inside `++...++`, `<ins>...</ins>`, or `%%...%%`).
- **Deletions (`%%~~...~~%%`)**: Deleted text is preserved and wrapped with `%%~~...~~%%` (unless deleting inside existing addition or comment markup).
- **IME Safe**: Defers wrapping during CJK / IME composition (`input.type.compose`) until `compositionend`, preserving candidate windows.
- **Smart Merging & Boundary Protection**: Merges consecutive additions/deletions and protects delimiters from accidental corruption on Backspace/Delete.
- **Review Commands**: Accept/Reject change at cursor, Accept/Reject all changes, Jump to next/previous change.

## Development

```bash
npm install
npm run build
```
