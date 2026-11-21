import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { MarkdownView } from "obsidian";
import { applyActionToSpan } from "./actions";
import { findTrackedSpans } from "./parser";
import { TrackChangesSettings, TrackedSpan } from "./types";

interface SidenoteItem {
  key: string;
  targetCm: EditorView;
  span: TrackedSpan;
  deletedText: string;
  anchorX: number;
  anchorY: number;
  cardEl?: HTMLElement;
  cardTop?: number;
  pathEl?: SVGPathElement;
  dotEl?: SVGCircleElement;
  anchorEl?: HTMLElement;
}

interface ViewOverlay {
  sourceViewEl: HTMLElement;
  scrollerEl: HTMLElement;
  layerEl: HTMLElement;
  svgEl: SVGSVGElement;
  cardsEl: HTMLElement;
  resizeObserver: ResizeObserver;
  onScroll: () => void;
  onMouseOver: (e: MouseEvent) => void;
  onMouseOut: (e: MouseEvent) => void;
  rafId: number | null;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const MIN_PANE_WIDTH_FOR_SIDENOTES = 380;
const MIN_NATURAL_MARGIN = 128;
const CARD_GAP = 6;

export class SidenoteManager {
  private overlays = new Map<HTMLElement, ViewOverlay>();
  private getSettings: () => TrackChangesSettings;
  private getKnownViews: () => Set<EditorView>;

  constructor(
    getSettings: () => TrackChangesSettings,
    getKnownViews: () => Set<EditorView>
  ) {
    this.getSettings = getSettings;
    this.getKnownViews = getKnownViews;
  }

  scheduleUpdateForView(view: MarkdownView): void {
    if (view.getMode() !== "source") {
      this.cleanupView(view);
      return;
    }

    const sourceViewEl = view.contentEl.querySelector<HTMLElement>(".markdown-source-view");
    const scrollerEl = sourceViewEl?.querySelector<HTMLElement>(".cm-scroller");
    if (!sourceViewEl || !scrollerEl) return;

    const settings = this.getSettings();
    if (!settings.showInlineDecorations || settings.deletionDisplayMode !== "sidenote") {
      this.cleanupSourceView(sourceViewEl);
      return;
    }

    const overlay = this.ensureOverlay(sourceViewEl, scrollerEl, view);
    if (overlay.rafId !== null) return;

    overlay.rafId = window.requestAnimationFrame(() => {
      overlay.rafId = null;
      this.renderOverlay(view, overlay);
    });
  }

  cleanupView(view: MarkdownView): void {
    const sourceViewEl = view.contentEl.querySelector<HTMLElement>(".markdown-source-view");
    if (sourceViewEl) {
      this.cleanupSourceView(sourceViewEl);
    }
  }

  destroy(): void {
    for (const sourceViewEl of Array.from(this.overlays.keys())) {
      this.cleanupSourceView(sourceViewEl);
    }
    this.overlays.clear();
  }

  private ensureOverlay(
    sourceViewEl: HTMLElement,
    scrollerEl: HTMLElement,
    view: MarkdownView
  ): ViewOverlay {
    const existing = this.overlays.get(sourceViewEl);
    if (existing) {
      if (existing.scrollerEl !== scrollerEl) {
        existing.scrollerEl.removeEventListener("scroll", existing.onScroll);
        scrollerEl.addEventListener("scroll", existing.onScroll, { passive: true });
        existing.scrollerEl = scrollerEl;
      }
      return existing;
    }

    const layerEl = document.createElement("div");
    layerEl.className = "tc-sidenote-layer";

    const svgEl = document.createElementNS(SVG_NS, "svg");
    svgEl.classList.add("tc-sidenote-svg");
    layerEl.appendChild(svgEl);

    const cardsEl = document.createElement("div");
    cardsEl.className = "tc-sidenote-cards";
    layerEl.appendChild(cardsEl);

    sourceViewEl.appendChild(layerEl);

    const onScroll = () => this.scheduleUpdateForView(view);
    scrollerEl.addEventListener("scroll", onScroll, { passive: true });

    const resizeObserver = new ResizeObserver(() => this.scheduleUpdateForView(view));
    resizeObserver.observe(sourceViewEl);

    const setHoverKey = (key: string | null) => {
      layerEl.querySelectorAll(".tc-active").forEach((el) => el.classList.remove("tc-active"));
      if (!key) return;
      layerEl
        .querySelectorAll(`[data-tc-key="${CSS.escape(key)}"]`)
        .forEach((el) => el.classList.add("tc-active"));
    };

    const onMouseOver = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const anchor = target?.closest<HTMLElement>(".cm-tc-del-anchor");
      if (anchor?.dataset.tcFrom) {
        setHoverKey(`outer:${anchor.dataset.tcFrom}`);
      }
    };

    const onMouseOut = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest(".cm-tc-del-anchor")) {
        setHoverKey(null);
      }
    };

    sourceViewEl.addEventListener("mouseover", onMouseOver);
    sourceViewEl.addEventListener("mouseout", onMouseOut);

    const overlay: ViewOverlay = {
      sourceViewEl,
      scrollerEl,
      layerEl,
      svgEl,
      cardsEl,
      resizeObserver,
      onScroll,
      onMouseOver,
      onMouseOut,
      rafId: null,
    };
    this.overlays.set(sourceViewEl, overlay);
    return overlay;
  }

  private cleanupSourceView(sourceViewEl: HTMLElement): void {
    const overlay = this.overlays.get(sourceViewEl);
    if (!overlay) return;

    if (overlay.rafId !== null) {
      window.cancelAnimationFrame(overlay.rafId);
    }
    overlay.scrollerEl.removeEventListener("scroll", overlay.onScroll);
    overlay.sourceViewEl.removeEventListener("mouseover", overlay.onMouseOver);
    overlay.sourceViewEl.removeEventListener("mouseout", overlay.onMouseOut);
    overlay.resizeObserver.disconnect();
    overlay.layerEl.remove();
    sourceViewEl.classList.remove("tc-reserve-right");
    this.overlays.delete(sourceViewEl);
  }

  private renderOverlay(view: MarkdownView, overlay: ViewOverlay): void {
    const settings = this.getSettings();
    if (
      view.getMode() !== "source" ||
      !settings.showInlineDecorations ||
      settings.deletionDisplayMode !== "sidenote"
    ) {
      this.cleanupSourceView(overlay.sourceViewEl);
      return;
    }

    const outerCm = (view.editor as unknown as { cm?: EditorView })?.cm;
    if (!outerCm) return;

    const { sourceViewEl, svgEl, cardsEl } = overlay;
    const docText = outerCm.state.doc.toString();
    const outerDeletions = findTrackedSpans(docText).filter((s) => s.kind === "deletion");

    if (outerDeletions.length === 0) {
      cardsEl.replaceChildren();
      svgEl.replaceChildren();
      sourceViewEl.classList.remove("tc-reserve-right");
      return;
    }

    const containerRect = sourceViewEl.getBoundingClientRect();
    if (containerRect.width < MIN_PANE_WIDTH_FOR_SIDENOTES) {
      cardsEl.replaceChildren();
      svgEl.replaceChildren();
      sourceViewEl.classList.remove("tc-reserve-right");
      return;
    }

    const cmContent = sourceViewEl.querySelector<HTMLElement>(".cm-sizer > .cm-content") ??
      sourceViewEl.querySelector<HTMLElement>(".cm-content");
    if (!cmContent) return;

    // Measure natural right margin without reservation first if currently reserved.
    const wasReserved = sourceViewEl.classList.contains("tc-reserve-right");
    if (wasReserved) {
      sourceViewEl.classList.remove("tc-reserve-right");
    }
    const naturalContentRect = cmContent.getBoundingClientRect();
    const naturalRightSpace = containerRect.right - naturalContentRect.right;

    let columnLeft: number;
    let columnWidth: number;
    if (naturalRightSpace < MIN_NATURAL_MARGIN) {
      sourceViewEl.classList.add("tc-reserve-right");
      columnWidth = 110;
      columnLeft = Math.max(containerRect.width - columnWidth - 8, 220);
    } else {
      columnLeft = naturalContentRect.right - containerRect.left + 10;
      columnWidth = Math.min(130, naturalRightSpace - 18);
    }

    // Collect visible deletion items with anchor coordinates.
    const items: SidenoteItem[] = [];
    const anchorElsByFrom = new Map<number, HTMLElement>();
    sourceViewEl.querySelectorAll<HTMLElement>(".cm-tc-del-anchor").forEach((el) => {
      if (el.closest(".cm-table-widget")) return;
      const from = Number(el.dataset.tcFrom);
      if (!Number.isNaN(from)) {
        anchorElsByFrom.set(from, el);
      }
    });

    for (const span of outerDeletions) {
      const anchorEl = anchorElsByFrom.get(span.from);
      let anchorX: number | null = null;
      let anchorY: number | null = null;

      if (anchorEl) {
        const r = anchorEl.getBoundingClientRect();
        anchorX = r.right - containerRect.left;
        anchorY = (r.top + r.bottom) / 2 - containerRect.top;
      } else {
        const coords = outerCm.coordsAtPos(span.from);
        if (coords) {
          anchorX = coords.left - containerRect.left;
          anchorY = (coords.top + coords.bottom) / 2 - containerRect.top;
        }
      }

      if (anchorX === null || anchorY === null) continue;
      if (anchorY < -80 || anchorY > containerRect.height + 80) continue;

      items.push({
        key: `outer:${span.from}`,
        targetCm: outerCm,
        span,
        deletedText: docText.slice(span.innerFrom, span.innerTo),
        anchorX,
        anchorY,
        anchorEl,
      });
    }

    // Also include collapsed deletion anchors inside Live Preview table cells.
    sourceViewEl.querySelectorAll<HTMLElement>(".cm-table-widget .cm-tc-del-anchor").forEach((el) => {
      const cellCm = EditorView.findFromDOM(el);
      if (!cellCm) return;
      const from = Number(el.dataset.tcFrom);
      const to = Number(el.dataset.tcTo);
      if (Number.isNaN(from) || Number.isNaN(to)) return;

      const cellDoc = cellCm.state.doc.toString();
      const cellSpan = findTrackedSpans(cellDoc).find(
        (s) => s.kind === "deletion" && s.from === from && s.to === to
      );
      if (!cellSpan) return;

      const r = el.getBoundingClientRect();
      const anchorX = r.right - containerRect.left;
      const anchorY = (r.top + r.bottom) / 2 - containerRect.top;
      if (anchorY < -80 || anchorY > containerRect.height + 80) return;

      items.push({
        key: `cell:${from}:${Math.round(anchorY)}`,
        targetCm: cellCm,
        span: cellSpan,
        deletedText: cellDoc.slice(cellSpan.innerFrom, cellSpan.innerTo),
        anchorX,
        anchorY,
        anchorEl: el,
      });
    });

    items.sort((a, b) => a.anchorY - b.anchorY || a.span.from - b.span.from);

    if (items.length === 0) {
      cardsEl.replaceChildren();
      svgEl.replaceChildren();
      return;
    }

    // Build cards first to measure heights accurately, then position with 1D collision avoidance.
    const cardFragment = document.createDocumentFragment();
    for (const item of items) {
      const card = this.createCardElement(item, columnWidth, overlay.layerEl);
      item.cardEl = card;
      cardFragment.appendChild(card);
    }
    cardsEl.replaceChildren(cardFragment);

    let nextMinTop = 8;
    for (const item of items) {
      const card = item.cardEl!;
      const h = card.offsetHeight;
      const desiredTop = Math.max(8, item.anchorY - Math.min(16, h / 2));
      const top = Math.max(desiredTop, nextMinTop);
      item.cardTop = top;
      card.style.transform = `translate3d(${columnLeft}px, ${top}px, 0)`;
      nextMinTop = top + h + CARD_GAP;
    }

    // Draw SVG leader lines.
    svgEl.setAttribute("width", String(containerRect.width));
    svgEl.setAttribute("height", String(containerRect.height));
    svgEl.setAttribute("viewBox", `0 0 ${containerRect.width} ${containerRect.height}`);

    const svgFragment = document.createDocumentFragment();
    for (const item of items) {
      const targetY = (item.cardTop ?? 8) + 12;
      const elbowX = Math.max(item.anchorX + 6, columnLeft - 8);
      const d = `M ${item.anchorX} ${item.anchorY} L ${elbowX} ${item.anchorY} L ${columnLeft} ${targetY}`;

      const path = document.createElementNS(SVG_NS, "path");
      path.classList.add("tc-sidenote-line");
      path.setAttribute("d", d);
      path.dataset.tcKey = item.key;

      const dot = document.createElementNS(SVG_NS, "circle");
      dot.classList.add("tc-sidenote-dot");
      dot.setAttribute("cx", String(item.anchorX));
      dot.setAttribute("cy", String(item.anchorY));
      dot.setAttribute("r", "1.8");
      dot.dataset.tcKey = item.key;

      item.pathEl = path;
      item.dotEl = dot;
      svgFragment.appendChild(path);
      svgFragment.appendChild(dot);
    }
    svgEl.replaceChildren(svgFragment);

    // Unused helper reference check: keep knownViews accessible if needed later.
    void this.getKnownViews;
  }

  private createCardElement(
    item: SidenoteItem,
    width: number,
    layerEl: HTMLElement
  ): HTMLElement {
    const card = document.createElement("div");
    card.className = "tc-sidenote-card";
    card.style.width = `${width}px`;
    card.dataset.tcKey = item.key;

    const header = document.createElement("div");
    header.className = "tc-sidenote-header";

    const badge = document.createElement("span");
    badge.className = "tc-sidenote-badge";
    badge.textContent = "已刪除";

    const actions = document.createElement("div");
    actions.className = "tc-sidenote-actions";

    const acceptBtn = document.createElement("button");
    acceptBtn.type = "button";
    acceptBtn.className = "tc-sidenote-btn tc-btn-accept";
    acceptBtn.textContent = "✓";
    acceptBtn.title = "接受刪除（移除此文字）";
    acceptBtn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    acceptBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      applyActionToSpan(item.targetCm, item.span, "accept");
      item.targetCm.focus();
    });

    const rejectBtn = document.createElement("button");
    rejectBtn.type = "button";
    rejectBtn.className = "tc-sidenote-btn tc-btn-reject";
    rejectBtn.textContent = "✕";
    rejectBtn.title = "拒絕刪除（還原此文字）";
    rejectBtn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    rejectBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      applyActionToSpan(item.targetCm, item.span, "reject");
      item.targetCm.focus();
    });

    actions.appendChild(acceptBtn);
    actions.appendChild(rejectBtn);
    header.appendChild(badge);
    header.appendChild(actions);

    const body = document.createElement("div");
    body.className = "tc-sidenote-body";
    body.textContent = item.deletedText;

    card.appendChild(header);
    card.appendChild(body);

    card.addEventListener("mouseenter", () => {
      layerEl.querySelectorAll(".tc-active").forEach((el) => el.classList.remove("tc-active"));
      card.classList.add("tc-active");
      item.pathEl?.classList.add("tc-active");
      item.dotEl?.classList.add("tc-active");
      item.anchorEl?.classList.add("tc-active");
    });

    card.addEventListener("mouseleave", () => {
      card.classList.remove("tc-active");
      item.pathEl?.classList.remove("tc-active");
      item.dotEl?.classList.remove("tc-active");
      item.anchorEl?.classList.remove("tc-active");
    });

    card.addEventListener("click", () => {
      item.targetCm.dispatch({
        selection: EditorSelection.cursor(item.span.innerFrom),
        scrollIntoView: true,
      });
      item.targetCm.focus();
    });

    return card;
  }
}
