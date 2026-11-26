/*
 * A headline marks one phrase, the way an auditor highlights the figure that matters: "Who signs off *the AI audit*?"
 * Asterisks around a phrase mark it. Everywhere a title is plain text (the page title, an email), the asterisks go.
 */

export interface Run {
  readonly text: string;
  readonly mark: boolean;
}

export const runs = (raw: string): Run[] =>
  raw
    .split('*')
    .map((text, i) => ({ text, mark: i % 2 === 1 }))
    .filter((run) => run.text !== '');

export const plain = (raw: string) => raw.replaceAll('*', '');

/** A title marks at most one phrase, opened and closed. */
export const wellMarked = (raw: string) => {
  const stars = raw.split('*').length - 1;
  return stars === 0 || stars === 2;
};
