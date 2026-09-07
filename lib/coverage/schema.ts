import { z } from "zod";

// Shape of one row in a network coverage export. Deliberately loose on
// string fields (networks format things inconsistently) but strict on the
// enum/number fields that drive downstream logic.
export const CoverageRowSchema = z.object({
  zip: z.string().trim().min(1),
  city: z.string().trim().min(1),
  state: z.string().trim().min(1),
  vertical: z.string().trim().min(1),
  payoutFloor: z.coerce.number().nonnegative(),
  pricingModel: z.enum(["PER_APPOINTMENT", "PER_CALL_DURATION", "CPL"]),
  isFlatRate: z.coerce.boolean().optional(), // recomputed, not trusted from source
  coverageZipCount: z.coerce.number().int().nonnegative().optional(),
  sourceRefreshedAt: z.string().optional(),
});

export type CoverageRow = z.infer<typeof CoverageRowSchema>;

export const CoverageFileSchema = z.array(CoverageRowSchema).min(1);
