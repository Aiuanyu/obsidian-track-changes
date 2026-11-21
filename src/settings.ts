import { App, PluginSettingTab, Setting, SettingDefinitionItem } from "obsidian";
import type TrackChangesPlugin from "./main";
import { AdditionSyntaxMode, DEFAULT_SETTINGS, DeletionDisplayMode } from "./types";

const ADDITION_SYNTAX_OPTIONS: Record<AdditionSyntaxMode, string> = {
  auto: "自動偵測（推薦）",
  plus: "強制使用 ++...++",
  ins: "強制使用 <ins>...</ins>",
};

const DELETION_DISPLAY_OPTIONS: Record<DeletionDisplayMode, string> = {
  sidenote: "右側氣泡 + 拉線（Word 樣式）",
  inline: "行內紅色刪除線",
};

export class TrackChangesSettingTab extends PluginSettingTab {
  plugin: TrackChangesPlugin;

  constructor(app: App, plugin: TrackChangesPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  private getAdditionSyntaxDesc(): string {
    const hasExtSyntax = this.plugin.isExtendedMarkdownSyntaxEnabled();
    const detectedLabel = hasExtSyntax
      ? "目前已偵測到並啟用 Extended Markdown Syntax（預設使用 ++...++）"
      : "目前未偵測到 Extended Markdown Syntax（預設自動改用 <ins>...</ins>）";
    return `++...++ 語法依賴 Extended Markdown Syntax 外掛；未安裝或未啟用時會自動降級使用 <ins>...</ins>。${detectedLabel}。`;
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        name: "新增文字標記語法",
        desc: this.getAdditionSyntaxDesc(),
        control: {
          type: "dropdown",
          key: "additionSyntax",
          options: ADDITION_SYNTAX_OPTIONS,
          defaultValue: DEFAULT_SETTINGS.additionSyntax,
        },
      },
      {
        name: "自動合併相鄰標記",
        desc: "連續打字或連續退格／刪除時，將相鄰的 ++a++++b++、<ins>a</ins><ins>b</ins> 與 %%~~a~~%%%%~~b~~%% 合併為單一區段。",
        control: {
          type: "toggle",
          key: "mergeAdjacentMarkers",
          defaultValue: DEFAULT_SETTINGS.mergeAdjacentMarkers,
        },
      },
      {
        name: "智慧邊界刪除防護",
        desc: "在新增／刪除標記邊界按 Backspace / Delete 時，保護標記符號不被破壞。",
        control: {
          type: "toggle",
          key: "smartBoundaryDelete",
          defaultValue: DEFAULT_SETTINGS.smartBoundaryDelete,
        },
      },
      {
        name: "編輯器即時視覺著色",
        desc: "在 Live Preview 與原始碼模式中，以綠色底線標示新增、紅色刪除線標示 %%~~刪除~~%%。",
        control: {
          type: "toggle",
          key: "showInlineDecorations",
          defaultValue: DEFAULT_SETTINGS.showInlineDecorations,
        },
      },
      {
        name: "刪除文字顯示模式",
        desc: "選擇將 %%~~刪除~~%% 顯示為行內紅色刪除線，或像 Word 追蹤修訂一樣顯示於右側氣泡並拉線至刪除處（支援 Live Preview 與原始碼模式）。",
        control: {
          type: "dropdown",
          key: "deletionDisplayMode",
          options: DELETION_DISPLAY_OPTIONS,
          defaultValue: DEFAULT_SETTINGS.deletionDisplayMode,
        },
      },
    ];
  }

  getControlValue(key: string): unknown {
    switch (key) {
      case "additionSyntax":
        return this.plugin.settings.additionSyntax;
      case "mergeAdjacentMarkers":
        return this.plugin.settings.mergeAdjacentMarkers;
      case "smartBoundaryDelete":
        return this.plugin.settings.smartBoundaryDelete;
      case "showInlineDecorations":
        return this.plugin.settings.showInlineDecorations;
      case "deletionDisplayMode":
        return this.plugin.settings.deletionDisplayMode;
      default:
        return undefined;
    }
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    switch (key) {
      case "additionSyntax":
        this.plugin.settings.additionSyntax = value as AdditionSyntaxMode;
        break;
      case "mergeAdjacentMarkers":
        this.plugin.settings.mergeAdjacentMarkers = Boolean(value);
        break;
      case "smartBoundaryDelete":
        this.plugin.settings.smartBoundaryDelete = Boolean(value);
        break;
      case "showInlineDecorations":
        this.plugin.settings.showInlineDecorations = Boolean(value);
        break;
      case "deletionDisplayMode":
        this.plugin.settings.deletionDisplayMode = value as DeletionDisplayMode;
        break;
      default:
        return;
    }
    await this.plugin.saveSettings();
    if (key === "showInlineDecorations" || key === "deletionDisplayMode") {
      this.plugin.refreshEditors();
    }
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName("Track Changes（追蹤修訂）").setHeading();

    new Setting(containerEl)
      .setName("新增文字標記語法")
      .setDesc(this.getAdditionSyntaxDesc())
      .addDropdown((dropdown) =>
        dropdown
          .addOptions(ADDITION_SYNTAX_OPTIONS)
          .setValue(this.plugin.settings.additionSyntax)
          .onChange(async (value) => {
            await this.setControlValue("additionSyntax", value);
          })
      );

    new Setting(containerEl)
      .setName("自動合併相鄰標記")
      .setDesc(
        "連續打字或連續退格／刪除時，將相鄰的 ++a++++b++、<ins>a</ins><ins>b</ins> 與 %%~~a~~%%%%~~b~~%% 合併為單一區段。"
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.mergeAdjacentMarkers)
          .onChange(async (value) => {
            await this.setControlValue("mergeAdjacentMarkers", value);
          })
      );

    new Setting(containerEl)
      .setName("智慧邊界刪除防護")
      .setDesc("在新增／刪除標記邊界按 Backspace / Delete 時，保護標記符號不被破壞。")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.smartBoundaryDelete)
          .onChange(async (value) => {
            await this.setControlValue("smartBoundaryDelete", value);
          })
      );

    new Setting(containerEl)
      .setName("編輯器即時視覺著色")
      .setDesc("在 Live Preview 與原始碼模式中，以綠色底線標示新增、紅色刪除線標示 %%~~刪除~~%%。")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showInlineDecorations)
          .onChange(async (value) => {
            await this.setControlValue("showInlineDecorations", value);
          })
      );

    new Setting(containerEl)
      .setName("刪除文字顯示模式")
      .setDesc(
        "選擇將 %%~~刪除~~%% 顯示為行內紅色刪除線，或像 Word 追蹤修訂一樣顯示於右側氣泡並拉線至刪除處（支援 Live Preview 與原始碼模式）。"
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOptions(DELETION_DISPLAY_OPTIONS)
          .setValue(this.plugin.settings.deletionDisplayMode)
          .onChange(async (value) => {
            await this.setControlValue("deletionDisplayMode", value);
          })
      );
  }
}
