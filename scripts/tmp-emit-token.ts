import { prisma } from "../lib/db/prisma";
import { getCredential } from "../lib/settings/credentials";
async function main() {
  const t = await getCredential("CLOUDFLARE_API_TOKEN");
  if (!t) { process.stderr.write("thiếu token\n"); process.exit(1); }
  process.stdout.write(t.trim());
}
void main().finally(() => prisma.$disconnect());
