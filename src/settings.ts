import { App, PluginSettingTab, Setting } from "obsidian";
import type TrackChangesPlugin from "./main";
import { AdditionSyntaxMode } from "./types";

export class TrackChangesSettingTab extends PluginSettingTab {
  plugin: TrackChangesPlugin;

  constructor(app: App, plugin: TrackChangesPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName("Track Changes（追蹤修訂）").setHeading();

    const hasExtSyntax = this.plugin.isExtendedMarkdownSyntaxEnabled();
    const detectedLabel = hasExtSyntax
      ? "目前已偵測到並啟用 Extended Markdown Syntax（預設使用 ++...++）"
      : "目前未偵測到 Extended Markdown Syntax（預設自動改用 <ins>...</ins>）";

    new Setting(containerEl)
      .setName("新增文字標記語法")
      .setDesc(
        `++...++ 語法依賴 Extended Markdown Syntax 外掛；未安裝或未啟用時會自動降級使用 <ins>...</ins>。${detectedLabel}。`
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOption("auto", "自動偵測（推薦）")
          .addOption("plus", "強制使用 ++...++")
          .addOption("ins", "強制使用 <ins>...</ins>")
          .setValue(this.plugin.settings.additionSyntax)
          .onChange(async (value) => {
            this.plugin.settings.additionSyntax = value as AdditionSyntaxMode;
            await this.plugin.saveSettings();
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
            this.plugin.settings.mergeAdjacentMarkers = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("智慧邊界刪除防護")
      .setDesc("在新增／刪除標記邊界按 Backspace / Delete 時，保護標記符號不被破壞。")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.smartBoundaryDelete)
          .onChange(async (value) => {
            this.plugin.settings.smartBoundaryDelete = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("編輯器即時視覺著色")
      .setDesc("在 Live Preview 與原始碼模式中，以綠色底線標示新增、紅色刪除線標示 %%~~刪除~~%%。")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showInlineDecorations)
          .onChange(async (value) => {
            this.plugin.settings.showInlineDecorations = value;
            await this.plugin.saveSettings();
            this.plugin.refreshEditors();
          })
      );
  }
}
