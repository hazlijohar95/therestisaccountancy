import assert from "node:assert/strict";
import { test } from "node:test";
import { admin, paidMember, Reply } from "./http.ts";
import { identify, IDENTITY_TTL_MS, isIdentity, type ClubIdentity } from "./identity.ts";

/** A club binding that answers with this identity, and remembers the cookie it was handed. */
const club = (who: ClubIdentity | null) => {
  const seen: (string | null)[] = [];
  return { seen, env: { CLUB: { member: async (cookie: string | null) => (seen.push(cookie), who) } } };
};
/** A request from its own browser: identities are cached per cookie, so each case signs in with a fresh one. */
const browser = (cookie = `session=${crypto.randomUUID()}`) => new Request("https://cpe.example/api/x", { headers: { cookie } });
const person = (role: "member" | "admin", paid: boolean): ClubIdentity => ({ id: 7, name: "Aina", email: "aina@firm.com.my", role, paid });

async function status(p: Promise<unknown>): Promise<number> {
  try {
    await p;
    return 200;
  } catch (error) {
    if (error instanceof Reply) return error.response.status;
    throw error;
  }
}

test("members' routes refuse the signed out with 401 and the unpaid with 403, and forward the cookie as it came", async () => {
  const out = club(null);
  assert.equal(await status(paidMember(browser("session=abc"), out.env)), 401);
  assert.deepEqual(out.seen, ["session=abc"]);
  assert.equal(await status(paidMember(browser(), club(person("member", false)).env)), 403);
  assert.equal(await status(paidMember(browser(), club(person("member", true)).env)), 200);
});

test("the Studio is for admins only, paid or not", async () => {
  assert.equal(await status(admin(browser(), club(null).env)), 401);
  assert.equal(await status(admin(browser(), club(person("member", true)).env)), 403, "a paid member is not an admin");
  assert.equal(await status(admin(browser(), club(person("admin", true)).env)), 200);
});

test("an identity of the wrong shape from the club is not a member", () => {
  assert.equal(isIdentity(person("member", true)), true);
  assert.equal(isIdentity({ id: "7", name: "Aina", email: "a@b.c", role: "member", paid: true }), false);
  assert.equal(isIdentity({ id: 7, name: "Aina", email: "a@b.c", role: "owner", paid: true }), false);
  assert.equal(isIdentity(null), false);
});

test("a signed-in identity is reused for a while, then asked again; signed out is never remembered", async () => {
  let clock = 0;
  const now = () => clock;
  const req = browser();
  const signedIn = club(person("member", true));
  await identify(req, signedIn.env, now);
  clock += IDENTITY_TTL_MS - 1;
  await identify(req, signedIn.env, now);
  assert.equal(signedIn.seen.length, 1, "within the window the club is not asked again");
  clock += 2;
  await identify(req, signedIn.env, now);
  assert.equal(signedIn.seen.length, 2, "after the window the club is asked again");

  const out = club(null);
  const anon = browser();
  await identify(anon, out.env, now);
  await identify(anon, out.env, now);
  assert.equal(out.seen.length, 2, "a signed-out answer is asked for every time");
});
