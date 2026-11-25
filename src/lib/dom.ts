/** The element the page's markup promises. Throws if the markup and the script have drifted apart. */
export function find<T extends Element>(selector: string, type: { new (): T; prototype: T }, root: Document | Element = document): T {
  const element = root.querySelector(selector);
  if (!(element instanceof type)) throw new Error(`Expected ${type.name} at ${selector}`);
  return element;
}

const figure = new Intl.NumberFormat('en-MY');

/**
 * "Clients you have now: enter a whole number from 0 to 100,000." How to fix the first out-of-range figure in a
 * form, named by its label, so the error never rests on the red border alone. Null when every figure is in range.
 */
export function rangeFix(form: HTMLFormElement): string | null {
  const bad = form.querySelector<HTMLInputElement>('input[aria-invalid="true"]');
  if (!bad) return null;
  const name = bad.labels?.[0]?.textContent?.trim() ?? 'This figure';
  const kind = bad.dataset['whole'] === undefined ? 'a number' : 'a whole number';
  const range = bad.max === '' ? `of ${figure.format(Number(bad.min))} or more` : `from ${figure.format(Number(bad.min))} to ${figure.format(Number(bad.max))}`;
  return `${name}: enter ${kind} ${range}.`;
}
