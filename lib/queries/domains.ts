import { prisma } from "@/lib/db/prisma";
import { findWebsiteForDomain } from "@/lib/publisher/link-domain";

/**
 * Domains, each with the Publisher website it corresponds to — if there is one.
 *
 * The two tables have no foreign key on purpose (see lib/publisher/link-domain.ts):
 * the relation IS "same host", and that is already written in both rows. What
 * was missing was not a column but a place where anyone could SEE it — a
 * domain registered here and a website connected in Publisher looked like
 * unrelated records, and whether a given domain had reporting attached was a
 * question answered by opening two screens and comparing strings by eye.
 */
export async function getDomains() {
  const [domains, websites] = await Promise.all([
    prisma.domain.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.website.findMany({ select: { id: true, name: true, url: true } }),
  ]);
  return domains.map((domain) => ({
    ...domain,
    publisherWebsite: findWebsiteForDomain(domain.name, websites),
  }));
}
