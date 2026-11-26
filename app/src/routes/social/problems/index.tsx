import { createFileRoute } from '@tanstack/react-router';
import { ProblemPage } from '../../../components/social/ProblemPage.tsx';
import { problemBoard, problemView } from '../../../functions/social-problems.ts';
import { socialTitle } from '../../../lib/title.ts';

/** This week's problem, or when the next one opens. */
export const Route = createFileRoute('/social/problems/')({
  staticData: { section: 'problems' },
  loader: async () => ({ board: await problemBoard(), view: await problemView({ data: { number: null } }) }),
  head: ({ loaderData }) => {
    const problem = loaderData?.view?.problem;
    return {
      meta: [
        ...socialTitle(problem ? `#${problem.number} ${problem.title}` : 'Problems'),
        { name: 'description', content: problem ? problem.ask : 'One problem a week. Answers stay hidden until you answer, and members with the seal rate the reasoning.' },
      ],
    };
  },
  component: () => {
    const { board, view } = Route.useLoaderData();
    return <ProblemPage board={board} view={view} here="/problems" />;
  },
});
