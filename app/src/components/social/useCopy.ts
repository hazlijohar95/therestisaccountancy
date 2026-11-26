import { useEffect, useState } from 'react';

/**
 * Copies a read-only field's text. Without a clipboard the field is selected, so the reader copies it by hand. Copy
 * buttons need a script, so `ready` stays false until the page has one, and a page without it never shows a button
 * that does nothing.
 */
export function useCopy() {
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState('');
  useEffect(() => setReady(true), []);
  const copy = async (id: string) => {
    const input = document.getElementById(id);
    if (!(input instanceof HTMLInputElement)) return;
    try {
      await navigator.clipboard.writeText(input.value);
      setStatus('Copied.');
    } catch {
      input.focus();
      input.select();
      setStatus('Selected. Press Ctrl+C or ⌘C to copy.');
    }
  };
  return { ready, status, copy };
}
