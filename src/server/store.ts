import { createActivity } from './activity.ts';
import { createBilling } from './billing.ts';
import { createCalls } from './calls.ts';
import { createClub } from './club.ts';
import type { Db } from './db.ts';
import { createFees } from './fees.ts';
import { createIncidents } from './incidents.ts';
import { createLimits } from './limits.ts';
import { createListings } from './listings.ts';
import { createMailings } from './mailings.ts';
import { createNewsletter } from './newsletter.ts';
import { createPlans } from './plans.ts';
import { createSchedule } from './schedule.ts';
import { createSignIns } from './sign-ins.ts';
import { createSocialCasebook } from './social-casebook.ts';
import { createSocialClaims } from './social-claims.ts';
import { createSocialFloor } from './social-floor.ts';
import { createSocialInvites } from './social-invites.ts';
import { createSocialNominations } from './social-nominations.ts';
import { createSocialNotifications } from './social-notifications.ts';
import { createSocialProblems } from './social-problems.ts';
import { createSocialProfiles } from './social-profiles.ts';
import { createSocialRequests } from './social-requests.ts';
import { createSocialShelf } from './social-shelf.ts';

export function createStore(db: Db, now: () => Date = () => new Date()) {
  return {
    club: createClub(db, now),
    activity: createActivity(db, now),
    limits: createLimits(db, now),
    mailings: createMailings(db, now),
    schedule: createSchedule(db, now),
    billing: createBilling(db, now),
    incidents: createIncidents(db, now),
    plans: createPlans(db, now),
    calls: createCalls(db, now),
    listings: createListings(db, now),
    fees: createFees(db, now),
    newsletter: createNewsletter(db, now),
    socialProfiles: createSocialProfiles(db, now),
    socialClaims: createSocialClaims(db, now),
    socialNominations: createSocialNominations(db, now),
    socialFloor: createSocialFloor(db, now),
    socialProblems: createSocialProblems(db, now),
    socialCasebook: createSocialCasebook(db, now),
    socialShelf: createSocialShelf(db, now),
    socialNotifications: createSocialNotifications(db, now),
    socialInvites: createSocialInvites(db, now),
    socialRequests: createSocialRequests(db, now),
    signIns: createSignIns(db, now),
  };
}
