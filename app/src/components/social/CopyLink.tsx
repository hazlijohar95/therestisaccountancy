import { useEffect, useState, type ReactNode } from 'react';

/**
 * A link shown once, in a read-only field, with a button that copies it. Without a clipboard the field is selected, so
 * the reader copies it by hand. The button shows only once the page's script runs, so it never sits there doing nothing.
 */
export function CopyLink({ id, link, children }: { id: string; link: string; children?: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState('');
  useEffect(() => setReady(true), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setStatus('Copied.');
    } catch {
      const input = document.getElementById(id);
      if (input instanceof HTMLInputElement) {
        input.focus();
        input.select();
      }
      setStatus('Selected. Press Ctrl+C or ⌘C to copy.');
    }
  };

  return (
    <>
      <label className="label-text" htmlFor={id}>
        Invite link
      </label>
      <input className="input" id={id} readOnly value={link} autoFocus />
      <div className="actions">
        <button className="btn sm" type="button" hidden={!ready} onClick={copy}>
          Copy link
        </button>
        {children}
      </div>
      <p className="small" aria-live="polite">
        {status}
      </p>
    </>
  );
}
