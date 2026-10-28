import { z } from "zod";

export const LoginQuery = z.object({ return: z.string().min(1) });

export const CallbackQuery = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});

/** A redirect has no body; the schema only gives the generator something to name. */
export const RedirectSchema = z.null();

export const RedeemBody = z.object({ code: z.string().min(1) });

export const RedeemSchema = z.object({
  token: z.string(),
  expires_at: z.date(),
  user: z.object({
    login: z.string(),
    name: z.string(),
    avatar_url: z.string(),
  }),
});

export const MeSchema = z.object({
  login: z.string(),
  name: z.string(),
  avatar_url: z.string().nullable(),
  scopes: z.array(z.string()),
});

export const AccessQuery = z.object({ repo: z.string().min(1) });

export const AccessSchema = z.object({ allowed: z.boolean() });
