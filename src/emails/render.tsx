import { render } from '@react-email/components';
import type { Letter } from '../server/letters.ts';
import { LetterEmail } from './LetterEmail.tsx';

/** The HTML and plain-text parts of a letter, both from the one React Email template. */
export async function renderLetter(letter: Letter): Promise<{ html: string; text: string }> {
  const email = <LetterEmail subject={letter.subject} lines={letter.lines} unsubscribe={letter.unsubscribe} />;
  const [html, text] = await Promise.all([render(email), render(email, { plainText: true })]);
  return { html, text };
}
