import { createFileRoute, notFound } from '@tanstack/react-router';
import { ProblemPage } from '../../../components/social/ProblemPage.tsx';
import { problemBoard, problemView } from '../../../functions/social-problems.ts';
import { socialTitle } from '../../../lib/title.ts';

/*
 * Any problem by number, open or in the archive. The archive beside it is loaded before the problem, so a number that
 * does not exist is still a page with the archive, answered with a 404.
 */
export const Route = createFileRoute('/social/problems/$')({
  staticData: { section: 'problems' },
  validateSearch: (search: Record<string, unknown>): { written?: true | undefined } => ({ written: search['written'] === 1 || search['written'] === '1' ? true : undefined }),
  beforeLoad: async () => ({ board: await problemBoard() }),
  loader: async ({ params }) => {
    const view = await problemView({ data: { number: params._splat ?? '' } });
    if (!view) throw notFound();
    return view;
  },
  head: ({ loaderData }) => ({
    meta: [
      ...socialTitle(loaderData ? `#${loaderData.problem.number} ${loaderData.problem.title}` : 'Problems'),
      { name: 'description', content: loaderData ? loaderData.problem.ask : 'One problem a week. Answers stay hidden until you answer, and members with the seal rate the reasoning.' },
    ],
  }),
  notFoundComponent: () => {
    const { board } = Route.useRouteContext();
    const { _splat } = Route.useParams();
    return <ProblemPage board={board} view={null} here={`/problems/${_splat ?? ''}`} />;
  },
  component: () => {
    const view = Route.useLoaderData();
    const { board } = Route.useRouteContext();
    const { _splat } = Route.useParams();
    return <ProblemPage board={board} view={view} here={`/problems/${_splat ?? ''}`} written={Route.useSearch().written === true} />;
  },
});
