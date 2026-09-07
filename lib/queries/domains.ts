import { prisma } from "@/lib/db/prisma";

export async function getDomains() {
  return prisma.domain.findMany({ orderBy: { createdAt: "desc" } });
}
