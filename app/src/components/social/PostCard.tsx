import { SocialLink } from './SocialLink.tsx';
import type { ReactNode } from 'react';
import { ROOMS } from '../../../../src/data/social.ts';
import { formatMoment } from '../../../../src/lib/format.ts';
import type { PostCard as Post } from '../../../../src/server/social-floor.ts';
import { Avatar } from './Avatar.tsx';
import { Flair } from './Flair.tsx';
import { PostText } from '../PostText.tsx';
import { UsefulButton } from './UsefulButton.tsx';

const EXCERPT = 280;

/** A post on the Floor. On its thread page (full) it shows the whole body, with the title as the page's heading. */
export function PostCard({ post, full = false, signedIn, children }: { post: Post; full?: boolean; signedIn: boolean; children?: ReactNode }) {
  const to = { to: '/social/post/$id', params: { id: String(post.id) } } as const;
  const room = ROOMS.find((r) => r.id === post.room)?.name ?? '';
  const excerpt = post.body.length > EXCERPT ? `${post.body.slice(0, EXCERPT).trimEnd()}…` : post.body;
  const replies = `${post.replies} ${post.replies === 1 ? 'reply' : 'replies'}`;
  return (
    <article className="post" aria-labelledby={`post-${post.id}-title`}>
      <div className="by">
        <SocialLink className="author" to="/social/@{$handle}" params={{ handle: post.author.handle }}>
          <Avatar name={post.author.name} track={post.author.track} sealed={post.author.sealed} size="sm" />
          <span className="name-line">
            {post.author.name}
            {post.author.sealed && (
              <svg className="seal" role="img" aria-label="Ticked">
                <use href="#seal" />
              </svg>
            )}
          </span>
        </SocialLink>
        <Flair track={post.author.track} />
        <span className="jur" title="Jurisdiction">
          {post.jurisdiction}
        </span>
        <span className="ago">
          <time dateTime={post.createdAt}>{formatMoment(post.createdAt)}</time> · {room}
          {post.editedAt && ' · edited'}
        </span>
      </div>
      {full ? (
        <h1 className="post-title" id={`post-${post.id}-title`}>
          {post.title}
        </h1>
      ) : (
        <h2 id={`post-${post.id}-title`}>
          <SocialLink className="post-link" {...to}>
            {post.title}
          </SocialLink>
        </h2>
      )}
      {post.body && (full ? <PostText text={post.body} /> : <p className="excerpt">{excerpt}</p>)}
      {post.correction && (
        <p className="correction">
          <svg aria-hidden="true">
            <use href="#i-flag" />
          </svg>
          <span>
            Corrected. A member with the seal flagged a mistake.{' '}
            <SocialLink {...to} hash={`reply-${post.correction.replyId}`}>
              Read the correction
            </SocialLink>
            .
          </span>
        </p>
      )}
      <div className="foot-row">
        {post.answer && (
          <SocialLink className="answered" {...to} hash={`reply-${post.answer.replyId}`}>
            <svg className="tick" aria-hidden="true">
              <use href="#tk" />
            </svg>
            Answered by a ticked {post.answer.credential}
          </SocialLink>
        )}
        <span className="spacer" />
        <UsefulButton target="post" id={post.id} useful={post.useful} pressed={post.usefulByViewer} canMark={signedIn && !post.mine} />
        {full ? (
          <span className="act">
            <svg aria-hidden="true">
              <use href="#i-reply" />
            </svg>
            {replies}
          </span>
        ) : (
          <SocialLink className="act" {...to} hash="replies">
            <svg aria-hidden="true">
              <use href="#i-reply" />
            </svg>
            {replies}
          </SocialLink>
        )}
        {children}
      </div>
    </article>
  );
}
