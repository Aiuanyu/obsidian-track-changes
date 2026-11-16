import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { MarkdownView, Notice, Plugin } from "obsidian";
import { applyActionAtCursor, applyActionToAll, jumpToChange } from "./actions";
import { createTrackChangesDecorations } from "./decorations";
import { createImeHandler } from "./imeHandler";
import { FloatingTrackIndicator } from "./indicator";
import { TrackChangesSettingTab } from "./settings";
import { createTrackChangesTransactionFilter } from "./transactionFilter";
import {
  AdditionDelimiters,
  DEFAULT_SETTINGS,
  INS_DELIMITERS,
  PLUS_DELIMITERS,
  TrackChangesSettings,
} from "./types";

export default class TrackChangesPlugin extends Plugin {
  settings: TrackChangesSettings = { ...DEFAULT_SETTINGS };
  private trackingEnabled = false;
  private indicator: FloatingTrackIndicator | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.indicator = new FloatingTrackIndicator({
      onPrev: () => this.withActiveEditorView((cm) => jumpToChange(cm, "prev")),
      onNext: () => this.withActiveEditorView((cm) => jumpToChange(cm, "next")),
      onAcceptCursor: () => {
        this.withActiveEditorView((cm) => {
          if (!applyActionAtCursor(cm, "accept")) {
            new Notice("游標處沒有可接受的修訂標記");
          }
        });
      },
      onRejectCursor: () => {
        this.withActiveEditorView((cm) => {
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
      const cm = this.getCmFromView(view);
      return cm ? cm.state === state : false;
    };

    const getDelimiters = () => this.getAdditionDelimiters();

    this.registerEditorExtension([
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
          this.withActiveEditorView((cm) => {
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
          this.withActiveEditorView((cm) => {
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

    // Update floating indicator when switching panes, files, or toggling Reading View / Live Preview.
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => this.updateIndicator())
    );
    this.registerEvent(
      this.app.workspace.on("layout-change", () => this.updateIndicator())
    );

    this.addSettingTab(new TrackChangesSettingTab(this.app, this));
    this.updateIndicator();
  }

  onunload(): void {
    this.indicator?.destroy();
    this.indicator = null;
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

  private withActiveEditorView(fn: (cm: EditorView) => void): void {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || view.getMode() !== "source") return;
    const cm = this.getCmFromView(view);
    if (cm) fn(cm);
  }

  refreshEditors(): void {
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.view instanceof MarkdownView) {
        const cm = this.getCmFromView(leaf.view);
        cm?.dispatch({});
      }
    });
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
