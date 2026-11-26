/**
 * Buttons open and close dialogs with commandfor and command="show-modal" or "close", which browsers do without a
 * script. This does the same where a browser does not know those attributes yet.
 */
export function initCommands(): void {
  if ('commandForElement' in HTMLButtonElement.prototype) return;
  document.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest('button[commandfor]') : null;
    const target = button ? document.getElementById(button.getAttribute('commandfor') ?? '') : null;
    if (!(target instanceof HTMLDialogElement)) return;
    const command = button?.getAttribute('command');
    if (command === 'show-modal' && !target.open) target.showModal();
    if (command === 'close') target.close();
  });
}
