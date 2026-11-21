import { EditorState } from "@codemirror/state";
import { EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { editorInfoField, MarkdownView, Notice, Plugin } from "obsidian";
import { applyActionAtCursor, applyActionToAll, jumpToChange } from "./actions";
import { createTrackChangesDecorations } from "./decorations";
import { createImeHandler } from "./imeHandler";
import { FloatingTrackIndicator } from "./indicator";
import { TrackChangesSettingTab } from "./settings";
import { SidenoteManager } from "./sidenotes";
import { createTrackChangesTransactionFilter } from "./transactionFilter";
import {
  AdditionDelimiters,
  DEFAULT_SETTINGS,
  INS_DELIMITERS,
  PLUS_DELIMITERS,
  refreshDecorationsEffect,
  TrackChangesSettings,
} from "./types";

export default class TrackChangesPlugin extends Plugin {
  settings: TrackChangesSettings = { ...DEFAULT_SETTINGS };
  private trackingEnabled = false;
  private indicator: FloatingTrackIndicator | null = null;
  private sidenotes: SidenoteManager | null = null;
  private knownViews = new Set<EditorView>();
  private lastTableCellBlurAt = 0;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.sidenotes = new SidenoteManager(
      () => this.settings,
      () => this.knownViews
    );

    this.indicator = new FloatingTrackIndicator({
      onPrev: () => this.withActiveEditorView((cm) => jumpToChange(cm, "prev")),
      onNext: () => this.withActiveEditorView((cm) => jumpToChange(cm, "next")),
      onAcceptCursor: () => {
        this.withFocusedOrActiveEditorView((cm) => {
          if (!applyActionAtCursor(cm, "accept")) {
            new Notice("游標處沒有可接受的修訂標記");
          }
        });
      },
      onRejectCursor: () => {
        this.withFocusedOrActiveEditorView((cm) => {
          if (!applyActionAtCursor(cm, "reject")) {
            new Notice("游標處沒有可拒絕的修訂標記");
          }
        });
      },
      onDisable: () => this.setTrackingEnabled(false),
    });

    const isTrackingActiveForState = (state: EditorState): boolean => {
      if (!this.trackingEnabled) return false;
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (!view || view.getMode() !== "source") return false;

      const outerCm = this.getCmFromView(view);
      if (outerCm && outerCm.state === state) {
        return !this.isEditingTableCell(view, outerCm);
      }

      // Support nested CodeMirror instances (e.g., Live Preview table cells) inside the active MarkdownView.
      for (const knownView of this.knownViews) {
        if (knownView.state === state && view.contentEl.contains(knownView.dom)) {
          return true;
        }
      }

      const info = state.field(editorInfoField, false);
      return info === view;
    };

    const { knownViews, sidenotes, app } = this;
    const onTableCellBlur = () => {
      this.lastTableCellBlurAt = Date.now();
    };
    const viewTracker = ViewPlugin.fromClass(
      class {
        private view: EditorView;

        constructor(view: EditorView) {
          this.view = view;
          knownViews.add(view);
          const info = view.state.field(editorInfoField, false);
          if (info instanceof MarkdownView) {
            sidenotes?.scheduleUpdateForView(info);
          }
        }

        update(update: ViewUpdate) {
          if (
            update.focusChanged &&
            !update.view.hasFocus &&
            update.view.dom.closest(".cm-table-widget") !== null
          ) {
            onTableCellBlur();
          }

          if (
            update.docChanged ||
            update.selectionSet ||
            update.viewportChanged ||
            update.geometryChanged ||
            update.transactions.some((tr) =>
              tr.effects.some((e) => e.is(refreshDecorationsEffect))
            )
          ) {
            const info = update.state.field(editorInfoField, false);
            if (info instanceof MarkdownView) {
              sidenotes?.scheduleUpdateForView(info);
            } else {
              const active = app.workspace.getActiveViewOfType(MarkdownView);
              if (active && active.contentEl.contains(update.view.dom)) {
                sidenotes?.scheduleUpdateForView(active);
              }
            }
          }
        }

        destroy() {
          knownViews.delete(this.view);
        }
      }
    );

    const getDelimiters = () => this.getAdditionDelimiters();

    this.registerEditorExtension([
      viewTracker,
      createTrackChangesTransactionFilter(
        isTrackingActiveForState,
        () => this.settings,
        getDelimiters
      ),
      createImeHandler(isTrackingActiveForState, getDelimiters),
      createTrackChangesDecorations(() => this.settings),
    ]);

    // Command Palette commands
    this.addCommand({
      id: "open-track-changes",
      name: "打開追蹤修訂模式",
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view || view.getMode() !== "source") return false;
        if (!checking) {
          this.setTrackingEnabled(true);
        }
        return true;
      },
    });

    this.addCommand({
      id: "close-track-changes",
      name: "關閉追蹤修訂模式",
      checkCallback: (checking) => {
        if (!this.trackingEnabled) return false;
        if (!checking) {
          this.setTrackingEnabled(false);
        }
        return true;
      },
    });

    this.addCommand({
      id: "toggle-track-changes",
      name: "切換追蹤修訂模式",
      callback: () => {
        if (this.trackingEnabled) {
          this.setTrackingEnabled(false);
        } else {
          const view = this.app.workspace.getActiveViewOfType(MarkdownView);
          if (!view || view.getMode() !== "source") {
            new Notice("追蹤修訂模式僅適用 Live Preview 或原始碼編輯模式");
            return;
          }
          this.setTrackingEnabled(true);
        }
      },
    });

    this.addCommand({
      id: "accept-change-at-cursor",
      name: "接受游標處修訂",
      editorCheckCallback: (checking, _editor, view) => {
        if (!(view instanceof MarkdownView) || view.getMode() !== "source") return false;
        if (!checking) {
          this.withFocusedOrActiveEditorView((cm) => {
            if (!applyActionAtCursor(cm, "accept")) {
              new Notice("游標處沒有可接受的修訂標記");
            }
          });
        }
        return true;
      },
    });

    this.addCommand({
      id: "reject-change-at-cursor",
      name: "拒絕游標處修訂",
      editorCheckCallback: (checking, _editor, view) => {
        if (!(view instanceof MarkdownView) || view.getMode() !== "source") return false;
        if (!checking) {
          this.withFocusedOrActiveEditorView((cm) => {
            if (!applyActionAtCursor(cm, "reject")) {
              new Notice("游標處沒有可拒絕的修訂標記");
            }
          });
        }
        return true;
      },
    });

    this.addCommand({
      id: "accept-all-changes",
      name: "接受全部修訂",
      editorCheckCallback: (checking, _editor, view) => {
        if (!(view instanceof MarkdownView) || view.getMode() !== "source") return false;
        if (!checking) {
          this.withActiveEditorView((cm) => {
            const count = applyActionToAll(cm, "accept");
            new Notice(count > 0 ? `已接受 ${count} 處修訂` : "目前沒有修訂標記");
          });
        }
        return true;
      },
    });

    this.addCommand({
      id: "reject-all-changes",
      name: "拒絕全部修訂",
      editorCheckCallback: (checking, _editor, view) => {
        if (!(view instanceof MarkdownView) || view.getMode() !== "source") return false;
        if (!checking) {
          this.withActiveEditorView((cm) => {
            const count = applyActionToAll(cm, "reject");
            new Notice(count > 0 ? `已拒絕 ${count} 處修訂` : "目前沒有修訂標記");
          });
        }
        return true;
      },
    });

    this.addCommand({
      id: "jump-next-change",
      name: "跳至下一個修訂",
      editorCheckCallback: (checking, _editor, view) => {
        if (!(view instanceof MarkdownView) || view.getMode() !== "source") return false;
        if (!checking) {
          this.withActiveEditorView((cm) => {
            if (!jumpToChange(cm, "next")) {
              new Notice("目前沒有修訂標記");
            }
          });
        }
        return true;
      },
    });

    this.addCommand({
      id: "jump-prev-change",
      name: "跳至上一個修訂",
      editorCheckCallback: (checking, _editor, view) => {
        if (!(view instanceof MarkdownView) || view.getMode() !== "source") return false;
        if (!checking) {
          this.withActiveEditorView((cm) => {
            if (!jumpToChange(cm, "prev")) {
              new Notice("目前沒有修訂標記");
            }
          });
        }
        return true;
      },
    });

    this.addCommand({
      id: "toggle-deletion-display-mode",
      name: "切換刪除顯示模式（行內／右側氣泡）",
      callback: async () => {
        this.settings.deletionDisplayMode =
          this.settings.deletionDisplayMode === "sidenote" ? "inline" : "sidenote";
        await this.saveSettings();
        this.refreshEditors();
        new Notice(
          this.settings.deletionDisplayMode === "sidenote"
            ? "刪除顯示：右側氣泡 + 拉線（Word 樣式）"
            : "刪除顯示：行內紅色刪除線"
        );
      },
    });

    // Update floating indicator when switching panes, files, or toggling Reading View / Live Preview.
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        this.updateIndicator();
        this.refreshAllSidenotes();
      })
    );
    this.registerEvent(
      this.app.workspace.on("layout-change", () => {
        this.updateIndicator();
        this.refreshAllSidenotes();
      })
    );

    this.addSettingTab(new TrackChangesSettingTab(this.app, this));
    this.updateIndicator();
    this.refreshAllSidenotes();
  }

  onunload(): void {
    this.indicator?.destroy();
    this.indicator = null;
    this.sidenotes?.destroy();
    this.sidenotes = null;
    this.knownViews.clear();
  }

  private setTrackingEnabled(enabled: boolean): void {
    this.trackingEnabled = enabled;
    this.updateIndicator();
    new Notice(enabled ? "已打開追蹤修訂模式" : "已關閉追蹤修訂模式");
  }

  private updateIndicator(): void {
    if (!this.indicator) return;
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const shouldShow =
      this.trackingEnabled && view !== null && view.getMode() === "source";
    this.indicator.setVisible(shouldShow);
  }

  isExtendedMarkdownSyntaxEnabled(): boolean {
    const plugins = (
      this.app as unknown as { plugins?: { enabledPlugins?: Set<string> } }
    ).plugins;
    return plugins?.enabledPlugins?.has("extended-markdown-syntax") ?? false;
  }

  getAdditionDelimiters(): AdditionDelimiters {
    if (this.settings.additionSyntax === "plus") return PLUS_DELIMITERS;
    if (this.settings.additionSyntax === "ins") return INS_DELIMITERS;
    return this.isExtendedMarkdownSyntaxEnabled() ? PLUS_DELIMITERS : INS_DELIMITERS;
  }

  private getCmFromView(view: MarkdownView): EditorView | null {
    // Access internal CodeMirror 6 EditorView attached to Obsidian's MarkdownView editor.
    const editor = view.editor as unknown as { cm?: EditorView };
    return editor?.cm ?? null;
  }

  private isEditingTableCell(view: MarkdownView, outerCm: EditorView): boolean {
    if (outerCm.hasFocus) return false;

    if (typeof document !== "undefined" && document.activeElement instanceof HTMLElement) {
      if (
        view.contentEl.contains(document.activeElement) &&
        document.activeElement.closest(".cm-table-widget") !== null
      ) {
        return true;
      }
    }

    for (const knownView of this.knownViews) {
      if (
        knownView !== outerCm &&
        knownView.hasFocus &&
        view.contentEl.contains(knownView.dom)
      ) {
        return true;
      }
    }

    return Date.now() - this.lastTableCellBlurAt < 150;
  }

  private getFocusedOrActiveEditorView(view: MarkdownView): EditorView | null {
    const outerCm = this.getCmFromView(view);
    for (const knownView of this.knownViews) {
      if (
        knownView !== outerCm &&
        knownView.hasFocus &&
        view.contentEl.contains(knownView.dom)
      ) {
        return knownView;
      }
    }
    return outerCm;
  }

  private withActiveEditorView(fn: (cm: EditorView) => void): void {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || view.getMode() !== "source") return;
    const cm = this.getCmFromView(view);
    if (cm) fn(cm);
  }

  private withFocusedOrActiveEditorView(fn: (cm: EditorView) => void): void {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || view.getMode() !== "source") return;
    const cm = this.getFocusedOrActiveEditorView(view);
    if (cm) fn(cm);
  }

  refreshEditors(): void {
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.view instanceof MarkdownView) {
        const cm = this.getCmFromView(leaf.view);
        cm?.dispatch({ effects: refreshDecorationsEffect.of(null) });
        if (leaf.view.getMode() === "source") {
          this.sidenotes?.scheduleUpdateForView(leaf.view);
        } else {
          this.sidenotes?.cleanupView(leaf.view);
        }
      }
    });
  }

  private refreshAllSidenotes(): void {
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.view instanceof MarkdownView) {
        if (leaf.view.getMode() === "source") {
          this.sidenotes?.scheduleUpdateForView(leaf.view);
        } else {
          this.sidenotes?.cleanupView(leaf.view);
        }
      }
    });
  }

  async loadSettings(): Promise<void> {
    const saved = (await this.loadData()) as Partial<TrackChangesSettings> | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
