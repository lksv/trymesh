// Drobné pomůcky pro stavbu DOM bez knihovny.
type Child = Node | string | number | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const element = Object.assign(document.createElement(tag), props);
  for (const child of children) if (child !== null && child !== undefined && child !== false) element.append(typeof child === 'number' ? String(child) : child);
  return element;
}

export const byId = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;

export function download(name: string, data: BlobPart, type: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  h('a', { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Číslo pro zobrazení: nejvýš tři desetinná místa, bez koncových nul.
export const fmt = (value: number): string => String(Math.round(value * 1000) / 1000);
