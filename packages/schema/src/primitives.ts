import { z } from "zod";

/** Integer milliseconds. Every time in Alcyo is one of these. */
export const Ms = z.number().int().nonnegative();
export type Ms = z.infer<typeof Ms>;

export const Id = z.string().min(1);
export type Id = z.infer<typeof Id>;
