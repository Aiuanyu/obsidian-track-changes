export interface IndicatorCallbacks {
  onPrev: () => void;
  onNext: () => void;
  onAcceptCursor: () => void;
  onRejectCursor: () => void;
  onDisable: () => void;
}

export class FloatingTrackIndicator {
  private el: HTMLDivElement;

  constructor(callbacks: IndicatorCallbacks) {
    this.el = document.createElement("div");
    this.el.className = "tc-floating-indicator tc-hidden";
    this.el.setAttribute("role", "status");
    this.el.setAttribute("aria-live", "polite");

    const dot = document.createElement("span");
    dot.className = "tc-indicator-dot";

    const label = document.createElement("span");
    label.className = "tc-indicator-label";
    label.textContent = "追蹤修訂中";

    const actions = document.createElement("div");
    actions.className = "tc-indicator-actions";

    const makeBtn = (text: string, title: string, cls: string, onClick: () => void) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `tc-indicator-btn ${cls}`;
      btn.textContent = text;
      btn.title = title;
      btn.addEventListener("mousedown", (e) => {
        // Keep focus in the editor so cursor position is preserved.
        e.preventDefault();
      });
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        onClick();
      });
      return btn;
    };

    actions.appendChild(makeBtn("↑", "上一個修訂", "tc-btn-nav", callbacks.onPrev));
    actions.appendChild(makeBtn("↓", "下一個修訂", "tc-btn-nav", callbacks.onNext));
    actions.appendChild(makeBtn("✓", "接受游標處修訂", "tc-btn-accept", callbacks.onAcceptCursor));
    actions.appendChild(makeBtn("✕", "拒絕游標處修訂", "tc-btn-reject", callbacks.onRejectCursor));
    actions.appendChild(makeBtn("結束", "關閉追蹤修訂模式", "tc-btn-close", callbacks.onDisable));

    this.el.appendChild(dot);
    this.el.appendChild(label);
    this.el.appendChild(actions);

    document.body.appendChild(this.el);
  }

  setVisible(visible: boolean): void {
    this.el.classList.toggle("tc-hidden", !visible);
  }

  destroy(): void {
    this.el.remove();
  }
}
