import { createFileRoute, Outlet } from '@tanstack/react-router';
import socialCss from '../../../../src/styles/social.css?url';
import { SocialLayout } from '../../components/social/Layout.tsx';
import { SocialNotFound } from '../../components/social/NotFound.tsx';
import { socialChrome } from '../../functions/social-chrome.ts';
import { socialTitle } from '../../lib/title.ts';

export const Route = createFileRoute('/social')({
  loader: async ({ context }) => ({ ...(await socialChrome()), member: context.member && { name: context.member.name } }),
  head: () => ({
    meta: [...socialTitle(), { name: 'description', content: 'The people in accountancy worth following. Every credential ticked, every claim sourced.' }],
    links: [{ rel: 'stylesheet', href: socialCss }],
  }),
  notFoundComponent: SocialNotFound,
  component: () => (
    <SocialLayout chrome={Route.useLoaderData()}>
      <Outlet />
    </SocialLayout>
  ),
});
