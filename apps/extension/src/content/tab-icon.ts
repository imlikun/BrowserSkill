/**
 * Tint the tab strip icon while an agent controls the page.
 *
 * Chromium offers no API to colour a tab, so the tab is identified two ways:
 * the orange tab group painted by the background worker, and this favicon
 * swap. The page's own icons are remembered and restored verbatim, including
 * the case where the site swaps them while control is active.
 */

const MANAGED_ATTR = "data-bsk-tab-icon";

interface SavedIcon {
  el: HTMLLinkElement;
  href: string | null;
}

function initialFor(agentName: string | null): string {
  const trimmed = (agentName ?? "").trim();
  return trimmed.length > 0 ? trimmed[0]!.toUpperCase() : "A";
}

/** Orange square badge with the agent's initial, as a self-contained data URI. */
export function agentIconHref(agentName: string | null): string {
  const letter = initialFor(agentName).replace(/[<>&"']/g, "");
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
    '<rect width="64" height="64" rx="14" fill="#f97316"/>' +
    `<text x="32" y="46" font-family="system-ui,-apple-system,Segoe UI,sans-serif" ` +
    `font-size="38" font-weight="700" fill="#ffffff" text-anchor="middle">${letter}</text>` +
    "</svg>";
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export class TabIconTinter {
  private saved: SavedIcon[] = [];
  private applied: string | null = null;
  private observer: MutationObserver | null = null;

  /** Apply, refresh or clear the tint. Safe to call repeatedly. */
  apply(active: boolean, agentName: string | null): void {
    if (!active) {
      this.clear();
      return;
    }
    const href = agentIconHref(agentName);
    if (this.applied === href) return;
    this.restore();
    this.saved = this.collect();
    for (const entry of this.saved) {
      entry.el.setAttribute(MANAGED_ATTR, "");
      entry.el.setAttribute("href", href);
    }
    if (this.saved.length === 0) {
      const link = document.createElement("link");
      link.rel = "icon";
      link.setAttribute(MANAGED_ATTR, "");
      link.setAttribute("href", href);
      document.head?.appendChild(link);
      this.saved.push({ el: link, href: null });
    }
    this.applied = href;
    this.watch();
  }

  clear(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.restore();
    this.applied = null;
  }

  private restore(): void {
    for (const { el, href } of this.saved) {
      if (!el.isConnected) continue;
      el.removeAttribute(MANAGED_ATTR);
      if (href === null) el.remove();
      else el.setAttribute("href", href);
    }
    this.saved = [];
  }

  private collect(): SavedIcon[] {
    const links = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]'));
    return links.map((el) => ({ el, href: el.getAttribute("href") }));
  }

  /**
   * Sites that swap their own favicon (unread badges and friends) would erase
   * the tint; re-assert it when a new icon link appears while controlling.
   */
  private watch(): void {
    if (this.observer || !document.head) return;
    const href = this.applied;
    if (!href) return;
    this.observer = new MutationObserver(() => {
      const current = this.applied;
      if (!current) return;
      for (const el of Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]'))) {
        if (el.getAttribute(MANAGED_ATTR) === null) {
          el.setAttribute(MANAGED_ATTR, "");
          el.setAttribute("href", current);
          this.saved.push({ el, href: null });
        }
      }
    });
    this.observer.observe(document.head, { childList: true, subtree: true });
  }
}
