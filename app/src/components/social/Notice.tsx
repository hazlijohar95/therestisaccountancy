import { createContext, useContext, useState, type ReactNode } from 'react';

/** A line a page says after something happened: an error, a note, or a status only screen readers hear. */
export interface Notice {
  readonly tone: 'error' | 'note' | 'quiet';
  readonly text: string;
}

const Say = createContext<(notice: Notice | null) => void>(() => undefined);
const Said = createContext<Notice | null>(null);

/** Lets anything on the page say a notice, which shows where the page puts <NoticeLine />. */
export function NoticeProvider({ children }: { children: ReactNode }) {
  const [notice, setNotice] = useState<Notice | null>(null);
  return (
    <Say.Provider value={setNotice}>
      <Said.Provider value={notice}>{children}</Said.Provider>
    </Say.Provider>
  );
}

export const useSay = () => useContext(Say);

export function NoticeLine() {
  const notice = useContext(Said);
  if (!notice) return null;
  if (notice.tone === 'error')
    return (
      <p className="error" role="alert">
        {notice.text}
      </p>
    );
  return (
    <p className={notice.tone === 'note' ? 'note' : 'sr-only'} role="status">
      {notice.text}
    </p>
  );
}
