/**
 * Wires every [data-copy] button to copy the input it names. Without a clipboard the input is selected, so the reader
 * copies it by hand. The buttons start hidden, so a page without scripts never shows one that does nothing.
 */
export function wireCopyButtons(): void {
  for (const button of document.querySelectorAll('[data-copy]')) {
    const input = document.getElementById(button.getAttribute('data-copy') ?? '');
    const status = document.querySelector('[data-copy-status]');
    if (!(button instanceof HTMLButtonElement) || !(input instanceof HTMLInputElement)) continue;
    button.hidden = false;
    button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(input.value);
        if (status) status.textContent = 'Copied.';
      } catch {
        input.focus();
        input.select();
        if (status) status.textContent = 'Selected. Press Ctrl+C or ⌘C to copy.';
      }
    });
  }
}
