import { createFileRoute } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { z } from 'zod';
import { firstMonthPrice, monthsFree, TERMS, terms, type Term } from '../../../../src/data/membership.ts';
import { capitalised, firstName, formatDay, numberWord } from '../../../../src/lib/format.ts';
import { Card, Cards } from '../../components/ui/Card.tsx';
import { Notice } from '../../components/ui/Notice.tsx';
import { PageHead } from '../../components/ui/PageHead.tsx';
import { Points } from '../../components/ui/Points.tsx';
import { Section } from '../../components/ui/Section.tsx';
import { Stat } from '../../components/ui/Stat.tsx';
import { useAction } from '../../components/useAction.ts';
import { checkout, membersPay } from '../../functions/members-billing.ts';
import { clubTitle } from '../../lib/title.ts';

export const Route = createFileRoute('/members/pay')({
  /* CHIP sends the member back with ?back=paid or ?back=failed. */
  validateSearch: z.object({ back: z.enum(['paid', 'failed']).optional().catch(undefined) }),
  loaderDeps: ({ search }) => ({ back: search.back }),
  loader: ({ deps }) => membersPay({ data: deps.back }),
  head: () => ({ meta: clubTitle('Membership') }),
  component: Pay,
});

/** The terms on offer. Someone who has never paid has their first month at the joining price, then the monthly rate. */
const offersFor = (joining: boolean) =>
  TERMS.map((term) => {
    if (term === 'month' && joining) return { term, tag: 'First month', price: firstMonthPrice, per: 'first month', note: `Then ${terms.month.label}.` };
    const free = monthsFree(term);
    return { term, tag: free > 0 ? `${capitalised(numberWord(free))} months free` : null, price: terms[term].price, per: `a ${term}`, note: null };
  });

function Pay() {
  const { member, standing, joining } = Route.useLoaderData();
  const { back } = Route.useSearch();
  const open = useAction(checkout, { refresh: 'never' });
  const [leaving, setLeaving] = useState(false);
  const error = open.refusal?.message;

  const pay = (term: Term) => async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const outcome = await open.run({ term });
    if (!outcome?.ok) return;
    setLeaving(true);
    window.location.assign(outcome.value.url);
  };

  /* Someone from the social site pays only once the club accepts a request from them. The form opens with their email in. */
  if (!member.clubApproved) {
    return (
      <>
        <PageHead
          label="Membership"
          title="Ask to join first."
          lead="The club takes members by request. We reply by email, then you pay here."
          actions={
            <a className="btn" href={`/join#email=${encodeURIComponent(member.email)}`}>
              Ask to join
            </a>
          }
        />
        {error && <Notice tone="error">{error}</Notice>}
      </>
    );
  }

  const lapsed = standing.access === 'unpaid' && standing.paidUntil !== null;
  const current = standing.access !== 'unpaid' && standing.paidUntil !== null;
  const until = standing.paidUntil ? formatDay(standing.paidUntil) : '';
  const renewsByCard = standing.cardOnFile && standing.renews;

  return (
    <>
      <PageHead
        label="Membership"
        title={lapsed ? 'Pay to carry on.' : current ? 'Pay ahead.' : `Welcome, ${firstName(member.name)}.`}
        lead={lapsed ? `Your last ${standing.term} ended ${until}.` : current ? `Paid until ${until}. New time starts after that.` : 'One step left. Pick how you pay.'}
      />

      {back === 'failed' && <Notice tone="error">Payment failed. Nothing was charged. Try again, or pick another bank.</Notice>}
      {back === 'paid' && standing.access !== 'paid' && <Notice tone="info">CHIP is still confirming. Refresh in a minute.</Notice>}
      {error && <Notice tone="error">{error}</Notice>}

      <Section title="Choose a plan">
        <Cards>
          {offersFor(joining).map((offer) => (
            <Card
              key={offer.term}
              tag={offer.tag}
              featured={offer.term === 'month' && joining}
              foot={
                <form method="POST" onSubmit={pay(offer.term)}>
                  <button className="btn" type="submit" disabled={open.busy || leaving}>
                    Pay {offer.price}
                  </button>
                </form>
              }
            >
              <Stat value={offer.price} label={offer.per} note={offer.note} />
            </Card>
          ))}
        </Cards>
        <Points
          items={[
            { icon: 'card', text: 'Online banking (FPX) on CHIP' },
            { icon: 'mail', text: 'Receipt by email' },
            { icon: 'repeat', text: renewsByCard ? 'Your card renews at the plan you paid last' : 'We email you before your time ends' },
            { icon: 'check', text: 'Stop any time. Keep access to the end.' },
          ]}
        />
      </Section>
    </>
  );
}
