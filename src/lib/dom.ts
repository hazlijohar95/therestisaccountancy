/** The element the page's markup promises. Throws if the markup and the script have drifted apart. */
export function find<T extends Element>(selector: string, type: { new (): T; prototype: T }, root: ParentNode = document): T {
  const element = root.querySelector(selector);
  if (!(element instanceof type)) throw new Error(`Expected ${type.name} at ${selector}`);
  return element;
}
