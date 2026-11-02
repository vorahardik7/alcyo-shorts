import { z } from "zod";

/** Integer milliseconds. Every time in Alcyo is one of these. */
export const Ms = z.number().int().nonnegative();
export type Ms = z.infer<typeof Ms>;

export const Id = z.string().min(1);
export type Id = z.infer<typeof Id>;

export const HttpUrl = z.url({ protocol: /^https?$/ });

/** A transcript line id as Claude sees it: L0001. */
export const LineId = z.string().regex(/^L\d{4,6}$/);
export type LineId = z.infer<typeof LineId>;

/** A transcript word id: w00001. */
export const WordId = z.string().regex(/^w\d{5,7}$/);
export type WordId = z.infer<typeof WordId>;

export const IsoDateTime = z.iso.datetime();

export const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/);

/** Every stored file starts at version 1. */
export const SchemaVersion = z.literal(1);
