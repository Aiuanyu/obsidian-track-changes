import { App, PluginSettingTab, Setting } from "obsidian";
import type TrackChangesPlugin from "./main";

export class TrackChangesSettingTab extends PluginSettingTab {
  plugin: TrackChangesPlugin;

  constructor(app: App, plugin: TrackChangesPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Track Changes（追蹤修訂）設定" });

    new Setting(containerEl)
      .setName("自動合併相鄰標記")
      .setDesc("連續打字或連續退格／刪除時，將相鄰的 ++a++++b++ 與 %%~~a~~%%%%~~b~~%% 合併為單一區段。")
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
      .setDesc("在 ++...++ 或 %%~~...~~%% 邊界按 Backspace / Delete 時，保護標記符號不被破壞。")
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
      .setDesc("在 Live Preview 與原始碼模式中，以綠色底線標示 ++新增++、紅色刪除線標示 %%~~刪除~~%%。")
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
