import type { PropertyFacts, RentListing, SaleListing, School } from "@evalprop/shared";
import type { Gateway, ProviderResult, RentEstimate, SubjectProfile } from "@evalprop/data";
import type { PipelineConfig } from "./config.ts";
import type { Deadline } from "./deadline.ts";
import type { PipelineProviders } from "./types.ts";

/** Stage 3 (ARCHITECTURE §7.1): everything the providers can tell us about the surroundings, fetched in parallel. */

export interface Gathered {
  rentCandidates: ProviderResult<RentListing[]>;
  saleCandidates: ProviderResult<SaleListing[]>;
  assignedSchools: ProviderResult<School[]>;
  nearbySchools: ProviderResult<School[]>;
  rentEstimate: ProviderResult<RentEstimate>;
}

const skipped = <T>(): ProviderResult<T> => ({
  ok: false,
  code: "UNAVAILABLE",
  message: "skipped: the property's location is unknown",
});

/**
 * Five calls, started together, each bounded by the gateway's per-call timeout (with its retry and cache)
 * and all of them by the shared overall deadline. A call that fails or runs out of time becomes a typed
 * failure in its slot; nothing here throws, so one bad provider never takes the others down.
 *
 * Rent and sale candidates are requested ONCE at the widest radius (`config.candidateRadiusMiles`, 2 mi)
 * and `packages/comps` applies the 0.5 / 1 / 2 mile rungs by each candidate's `distanceMiles`.
 *
 * Without coordinates (the property record is unavailable) nothing can be searched: every slot is a
 * typed "unavailable" and the caller says so in `dataNotes`.
 */
export async function gather(args: {
  facts: PropertyFacts;
  gateway: Gateway;
  providers: PipelineProviders;
  deadline: Deadline;
  config: PipelineConfig;
}): Promise<Gathered> {
  const { facts, gateway, providers, deadline, config } = args;
  const { latitude, longitude } = facts;
  if (latitude === undefined || longitude === undefined) {
    return {
      rentCandidates: skipped(),
      saleCandidates: skipped(),
      assignedSchools: skipped(),
      nearbySchools: skipped(),
      rentEstimate: skipped(),
    };
  }

  const subject: SubjectProfile = {
    latitude,
    longitude,
    ...(facts.propertyType !== undefined ? { propertyType: facts.propertyType } : {}),
    ...(facts.beds !== undefined ? { beds: facts.beds } : {}),
    ...(facts.baths !== undefined ? { baths: facts.baths } : {}),
    ...(facts.sqft !== undefined ? { sqft: facts.sqft } : {}),
    ...(facts.yearBuilt !== undefined ? { yearBuilt: facts.yearBuilt } : {}),
  };
  const location = { latitude, longitude };

  const rent = gateway.rent(providers.rent.name, providers.rent.provider);
  const sales = gateway.sales(providers.sales.name, providers.sales.provider);
  const schools = gateway.schools(providers.schools.name, providers.schools.provider);

  const [rentCandidates, saleCandidates, assignedSchools, nearbySchools, rentEstimate] = await Promise.all([
    deadline.race(rent.rentCandidates(subject, config.candidateRadiusMiles)),
    deadline.race(sales.saleCandidates(subject, config.candidateRadiusMiles)),
    deadline.race(schools.assignedSchools(location)),
    deadline.race(schools.nearbySchools(location, config.nearbySchoolsRadiusMiles)),
    deadline.race(rent.rentEstimate(subject)),
  ]);
  return { rentCandidates, saleCandidates, assignedSchools, nearbySchools, rentEstimate };
}
