import assert from "node:assert/strict";
import { test } from "node:test";
import { admin, paidMember, Reply } from "./http.ts";
import { isIdentity, type ClubIdentity } from "./identity.ts";

/** A club binding that answers with this identity, and remembers the cookie it was handed. */
const club = (who: ClubIdentity | null) => {
  const seen: (string | null)[] = [];
  return { seen, env: { CLUB: { member: async (cookie: string | null) => (seen.push(cookie), who) } } };
};
const request = new Request("https://cpe.example/api/x", { headers: { cookie: "session=abc" } });
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
  assert.equal(await status(paidMember(request, out.env)), 401);
  assert.deepEqual(out.seen, ["session=abc"]);
  assert.equal(await status(paidMember(request, club(person("member", false)).env)), 403);
  assert.equal(await status(paidMember(request, club(person("member", true)).env)), 200);
});

test("the Studio is for admins only, paid or not", async () => {
  assert.equal(await status(admin(request, club(null).env)), 401);
  assert.equal(await status(admin(request, club(person("member", true)).env)), 403, "a paid member is not an admin");
  assert.equal(await status(admin(request, club(person("admin", true)).env)), 200);
});

test("an identity of the wrong shape from the club is not a member", () => {
  assert.equal(isIdentity(person("member", true)), true);
  assert.equal(isIdentity({ id: "7", name: "Aina", email: "a@b.c", role: "member", paid: true }), false);
  assert.equal(isIdentity({ id: 7, name: "Aina", email: "a@b.c", role: "owner", paid: true }), false);
  assert.equal(isIdentity(null), false);
});
