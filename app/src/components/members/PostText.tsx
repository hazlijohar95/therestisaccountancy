import { paragraphs, pieces } from '../../../../src/lib/text.ts';
import s from './PostText.module.css';

/** A post's plain text: paragraphs, line breaks and http(s) links. Never HTML. */
export function PostText({ text }: { text: string }) {
  return (
    <div className={`post-text ${s.text}`}>
      {paragraphs(text).map((paragraph, i) => (
        <p key={i}>
          {pieces(paragraph).map((piece, j) =>
            piece.kind === 'link' ? (
              <a key={j} href={piece.href} rel="nofollow ugc noopener noreferrer" target="_blank">
                {piece.text}
              </a>
            ) : (
              piece.text
            ),
          )}
        </p>
      ))}
    </div>
  );
}
