// Drobné pomůcky pro stavbu DOM bez knihovny.
type Child = Node | string | number | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const element = Object.assign(document.createElement(tag), props);
  // A list whose row was marked `selected` before it got into the list: the list is told its value
  // once the rows are in it. A browser keeps the mark of a row as it is added; the DOM of the
  // tests (happy-dom) loses it and would show, and record, another row.
  const chosen =tag === 'select' ? children.filter((child): child is HTMLOptionElement => typeof child === 'object' && child !== null && (child as Element).tagName === 'OPTION' && (child as HTMLOptionElement).selected).pop() : undefined;
  for (const child of children) if (child !== null && child !== undefined && child !== false) element.append(typeof child === 'number' ? String(child) : child);
  if (chosen) (element as HTMLSelectElement).value = chosen.value;
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

// Marks a field whose content is not valid, with the reason as its title.
export function markProblem(input: HTMLInputElement, problem: string | undefined): void {
  input.classList.toggle('invalid', problem !== undefined);
  input.title = problem ?? '';
}
