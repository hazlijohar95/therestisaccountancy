import assert from "node:assert/strict";
import { test } from "node:test";
import { createCatalogue } from "./catalogue.ts";
import { memoryDb } from "./node-db.ts";
import { publishedCache } from "./published.ts";

function counted() {
  const catalogue = createCatalogue(memoryDb(), () => new Date("2026-11-26T10:00:00Z"));
  catalogue.seed();
  const loads: string[] = [];
  const load = async (courseId: string, version: number) => {
    loads.push(`${courseId}@${version}`);
    return catalogue.published(courseId, version);
  };
  return { catalogue, loads, load };
}

test("a published version is read from the catalogue once, then from the isolate", async () => {
  const { loads, load } = counted();
  const cache = publishedCache(load);
  const first = await cache.get("five-threats", 1);
  const again = await cache.get("five-threats", 1);
  assert.equal(again, first);
  assert.deepEqual(loads, ["five-threats@1"]);
});

test("a version not published yet is asked for again, and found once it is", async () => {
  const { catalogue, loads, load } = counted();
  const cache = publishedCache(load);
  catalogue.openDraft("five-threats", "admin@club.test");
  assert.equal(await cache.get("five-threats", 2), null, "a draft is not published");
  catalogue.publish("five-threats", "admin@club.test");
  assert.equal((await cache.get("five-threats", 2))?.version, 2);
  assert.deepEqual(loads, ["five-threats@2", "five-threats@2"]);
});

test("versions listed elsewhere are kept, and the least recently used goes first past the limit", async () => {
  const { catalogue, loads, load } = counted();
  const cache = publishedCache(load, 2);
  const [a, b, c] = catalogue.latest();
  cache.remember(a!);
  cache.remember(b!);
  await cache.get(a!.courseId, 1);
  cache.remember(c!);
  assert.equal(cache.size, 2);
  await cache.get(a!.courseId, 1);
  await cache.get(c!.courseId, 1);
  assert.deepEqual(loads, [], "a and c stayed");
  await cache.get(b!.courseId, 1);
  assert.deepEqual(loads, [`${b!.courseId}@1`], "b was evicted");
});
