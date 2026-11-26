import { DurableObject, exports } from "cloudflare:workers";
import { createCatalogue } from "./catalogue.ts";
import { durableDb } from "./db.ts";
import { createLearner } from "./learner.ts";

/** The one catalogue: courses, their versions, and the register of issued certificates. Seeded with the sample courses on start. */
export class CatalogueStore extends DurableObject {
  readonly #catalogue;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.#catalogue = createCatalogue(durableDb(ctx.storage));
    this.#catalogue.seed();
  }

  open() {
    return this.#catalogue;
  }
}

/** One per member, named by their club member id. */
export class LearnerStore extends DurableObject {
  readonly #learner;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.#learner = createLearner(durableDb(ctx.storage));
  }

  open() {
    return this.#learner;
  }
}

/** Each call on what these return is a round trip to the object, so every method returns a promise. Dispose when done. */
export const openCatalogue = () => exports.CatalogueStore.getByName("catalogue").open();
export const openLearner = (memberId: number) => exports.LearnerStore.getByName(`member:${memberId}`).open();
