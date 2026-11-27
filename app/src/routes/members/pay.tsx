import { createFileRoute } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { z } from 'zod';
import { anyTerm, firstMonthPrice, joiningRate, monthsFree, TERMS, terms, type Term } from '../../../../src/data/membership.ts';
import { capitalised, formatDay, numberWord } from '../../../../src/lib/format.ts';
import { Masthead } from '../../components/club/Masthead.tsx';
import { Notice } from '../../components/club/Notice.tsx';
import { useAction } from '../../components/useAction.ts';
import { checkout, membersPay } from '../../functions/members-billing.ts';
import { clubTitle } from '../../lib/title.ts';
import s from './pay.module.css';

export const Route = createFileRoute('/members/pay')({
  /* CHIP sends the member back with ?back=paid or ?back=failed. */
  validateSearch: z.object({ back: z.enum(['paid', 'failed']).optional().catch(undefined) }),
  loaderDeps: ({ search }) => ({ back: search.back }),
  loader: ({ deps }) => membersPay({ data: deps.back }),
  head: () => ({ meta: clubTitle('Membership') }),
  component: Pay,
});

/** The terms on offer. Someone who has never paid has their first month at the joining price, and is told what follows it. */
const offersFor = (joining: boolean) =>
  TERMS.map((term) => {
    if (term === 'month' && joining) return { term, label: `${firstMonthPrice} for your first month`, price: firstMonthPrice, note: `Then ${terms.month.label}.` };
    const free = monthsFree(term);
    return { term, label: terms[term].label, price: terms[term].price, note: free > 0 ? `${capitalised(numberWord(free))} months free.` : null };
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
        <Masthead label="Membership" title="Ask to join first.">
          <p>The club takes members by request. Your Social account stays free. To join the club, send a request: we read each one and reply by email, and once we accept it you pay here with the same account.</p>
          <p>
            <a className="btn" href={`/join#email=${encodeURIComponent(member.email)}`}>
              Ask to join
            </a>
          </p>
        </Masthead>
        {error && <Notice tone="error">{error}</Notice>}
      </>
    );
  }

  const lapsed = standing.access === 'unpaid' && standing.paidUntil !== null;
  const current = standing.access !== 'unpaid' && standing.paidUntil !== null;
  const renewsByCard = standing.cardOnFile && standing.renews;

  return (
    <>
      <Masthead label="Membership" title={lapsed ? 'Your membership needs a payment.' : current ? 'Pay ahead.' : `Welcome, ${member.name}. One step left.`}>
        <p>
          {lapsed
            ? `Your last paid ${standing.term} ended on ${formatDay(standing.paidUntil ?? '')}. Pay for ${anyTerm} to carry on.`
            : current
              ? `You are paid until ${formatDay(standing.paidUntil ?? '')}. What you pay for now is added after that.`
              : `${joiningRate} Choose one, pay, and you are in.`}
        </p>
      </Masthead>

      {back === 'failed' && <Notice tone="error">The payment did not go through, and nothing was charged. Try again, or use another card.</Notice>}
      {back === 'paid' && standing.access !== 'paid' && <Notice>CHIP is still confirming your payment. Refresh this page in a minute.</Notice>}
      {error && <Notice tone="error">{error}</Notice>}

      <section className={`wrap ${s.block}`} aria-labelledby="pay-title">
        <h2 className="head" id="pay-title">
          Pay by the {TERMS.join(' or the ')}
        </h2>
        <ul className={s.offers}>
          {offersFor(joining).map((offer) => (
            <li key={offer.term}>
              <h3 className={`serif ${s.rate}`}>{offer.label}</h3>
              {offer.note && <p className={s.note}>{offer.note}</p>}
              <form method="POST" onSubmit={pay(offer.term)}>
                <button className="btn" type="submit" disabled={open.busy || leaving}>
                  Pay {offer.price} with CHIP
                </button>
              </form>
            </li>
          ))}
        </ul>
        <p className="small">
          You pay on CHIP's secure page by online banking (FPX), then come straight back here. CHIP emails you a receipt.{' '}
          {renewsByCard ? `Your card renews at whichever you paid for last, ${anyTerm}.` : 'Before your paid time ends we email you a link to pay for more.'} Stop any time: you keep access to the end of the time you paid for.
        </p>
      </section>
    </>
  );
}
