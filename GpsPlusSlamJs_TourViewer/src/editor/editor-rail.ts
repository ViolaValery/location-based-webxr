/**
 * The desktop editor's left rail (M6 E1, the chosen variant 1): the
 * tour's codes, pins and photos in groups with counts, a search, select
 * and hover both ways with the map, and a collapsed form that keeps one
 * count per group. Every title is set with `textContent` (a zip anyone
 * can write, M6 E1 plan review #2).
 *
 * @see editor-rail.ts.md
 */

import {
  filterItems,
  type EditorItem,
  type EditorItemKind,
  type EditorModel,
} from "./editor-model.js";

const GROUPS: readonly { kind: EditorItemKind; title: string }[] = [
  { kind: "code", title: "Codes" },
  { kind: "pin", title: "Pins" },
  { kind: "photo", title: "Photos" },
  { kind: "station", title: "Stations" },
];

export interface EditorRailDom {
  readonly rail: HTMLElement;
  readonly body: HTMLElement;
  readonly mini: HTMLElement;
  readonly filter: HTMLInputElement;
  readonly collapse: HTMLButtonElement;
  readonly collapseIcon: SVGPathElement;
}

export interface EditorRail {
  render(model: EditorModel): void;
  /** Redraw after an edit: the search and the selection stay. */
  update(model: EditorModel): void;
  select(id: string | null): void;
  hover(id: string, on: boolean): void;
  /** Fold the rail to its per-group counts, or open it. */
  collapse(on: boolean): void;
  /** The rail's right edge in window pixels (0 while hidden): the free
   *  part of the map starts there. */
  right(): number;
}

function iconOf(item: EditorItem): HTMLElement {
  const icon = document.createElement("span");
  if (item.kind === "code" || item.kind === "station") {
    icon.className = item.kind === "code" ? "mini-code" : "mini-station";
    icon.textContent = String(item.number ?? "");
  } else {
    icon.className = item.kind === "photo" ? "mini-photo" : "mini-note";
  }
  return icon;
}

export function createEditorRail(
  dom: EditorRailDom,
  handlers: {
    readonly onSelect: (id: string) => void;
    readonly onHover: (id: string, on: boolean) => void;
    /** The rail's width changed (collapsed or expanded). */
    readonly onResize: () => void;
  },
): EditorRail {
  let model: EditorModel | null = null;
  let selected: string | null = null;
  const rows = new Map<string, HTMLButtonElement>();

  function rowFor(item: EditorItem): HTMLButtonElement {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "row";
    row.dataset["id"] = item.id;
    const iconBox = document.createElement("span");
    iconBox.className = "row-icon";
    iconBox.append(iconOf(item));
    const text = document.createElement("span");
    text.className = "row-text";
    const title = document.createElement("span");
    title.className = "row-title";
    title.textContent = item.title;
    const meta = document.createElement("span");
    meta.className = "row-meta";
    meta.textContent = item.meta;
    text.append(title, meta);
    row.append(iconBox, text);
    row.addEventListener("click", () => {
      handlers.onSelect(item.id);
    });
    row.addEventListener("mouseenter", () => {
      handlers.onHover(item.id, true);
    });
    row.addEventListener("mouseleave", () => {
      handlers.onHover(item.id, false);
    });
    return row;
  }

  function draw(): void {
    rows.clear();
    dom.body.replaceChildren();
    if (model === null) return;
    const visible = filterItems(model.items, dom.filter.value);
    const searching = dom.filter.value.trim() !== "";
    for (const group of GROUPS) {
      const items = visible.filter((i) => i.kind === group.kind);
      if (searching && items.length === 0) continue;
      const section = document.createElement("div");
      section.className = "group";
      section.dataset["kind"] = group.kind;
      const head = document.createElement("div");
      head.className = "group-head";
      const name = document.createElement("span");
      name.textContent = group.title;
      const count = document.createElement("span");
      count.className = "count";
      count.textContent = String(model.counts[group.kind]);
      head.append(name, count);
      section.append(head);
      for (const item of items) {
        const row = rowFor(item);
        rows.set(item.id, row);
        section.append(row);
      }
      if (group.kind === "photo" && !searching) {
        const hint = document.createElement("p");
        hint.className = "rail-hint";
        hint.textContent =
          "Pins and photos are both notes: you will edit, move and delete them the same way.";
        section.append(hint);
      }
      dom.body.append(section);
    }
    if (searching && visible.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-filter";
      empty.textContent = "Nothing matches that text.";
      dom.body.append(empty);
    }
    markSelected();
  }

  function drawMini(): void {
    dom.mini.replaceChildren();
    if (model === null) return;
    for (const group of GROUPS) {
      const button = document.createElement("button");
      button.type = "button";
      button.title = group.title;
      const icon = document.createElement("span");
      icon.className = {
        code: "mini-code",
        pin: "mini-note",
        photo: "mini-photo",
        station: "mini-station",
      }[group.kind];
      if (group.kind === "code" || group.kind === "station") {
        icon.textContent = "#";
      }
      const count = document.createElement("span");
      count.textContent = String(model.counts[group.kind]);
      button.append(icon, count);
      button.addEventListener("click", () => {
        setCollapsed(false);
        dom.body
          .querySelector(`.group[data-kind="${group.kind}"]`)
          ?.scrollIntoView({ block: "start" });
      });
      dom.mini.append(button);
    }
  }

  function markSelected(): void {
    for (const [id, row] of rows) {
      const on = id === selected;
      row.classList.toggle("sel", on);
      row.setAttribute("aria-pressed", String(on));
    }
  }

  function setCollapsed(on: boolean): void {
    dom.rail.classList.toggle("collapsed", on);
    const label = on ? "Expand the list" : "Collapse the list";
    dom.collapse.setAttribute("aria-label", label);
    dom.collapse.title = label;
    dom.collapseIcon.setAttribute("d", on ? "M9 6l6 6-6 6" : "M15 6l-6 6 6 6");
    handlers.onResize();
  }

  dom.collapse.addEventListener("click", () => {
    setCollapsed(!dom.rail.classList.contains("collapsed"));
  });
  dom.filter.addEventListener("input", draw);

  return {
    render(next) {
      model = next;
      dom.filter.value = "";
      dom.rail.hidden = false;
      draw();
      drawMini();
    },
    update(next) {
      model = next;
      draw();
      drawMini();
    },
    select(id) {
      selected = id;
      markSelected();
      if (id !== null) rows.get(id)?.scrollIntoView({ block: "nearest" });
    },
    hover(id, on) {
      rows.get(id)?.classList.toggle("hover", on);
    },
    collapse: setCollapsed,
    right() {
      return dom.rail.hidden ? 0 : dom.rail.getBoundingClientRect().right;
    },
  };
}
