/**
 * Claude (Anthropic API) access for document reading. Enabled when ANTHROPIC_API_KEY is set in the
 * environment; every feature that uses it has a manual path that works without it.
 *
 * Customer documents are untrusted input: they are passed as document content and the model is told
 * to treat their text as data. No tools are given, and results only ever pre-fill a form that a person
 * checks and confirms.
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { AppError } from "../errors";

export const AI_MODEL = process.env.MJMS_AI_MODEL || "claude-opus-5-5";

export function aiConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

let client: Anthropic | null = null;
function anthropic(): Anthropic {
  if (!aiConfigured()) throw new AppError("The document assistant is not set up: add ANTHROPIC_API_KEY in the hosting settings.", "integration");
  client ??= new Anthropic();
  return client;
}

export type AiDocument = { bytes: Buffer; mimeType: string; name: string };
export type AiResult<T> = { data: T; model: string; inputTokens: number; outputTokens: number };

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

function documentBlock(doc: AiDocument): Anthropic.Beta.BetaContentBlockParam {
  const data = doc.bytes.toString("base64");
  if (doc.mimeType === "application/pdf") return { type: "document", source: { type: "base64", media_type: "application/pdf", data }, title: doc.name };
  if (IMAGE_TYPES.has(doc.mimeType)) return { type: "image", source: { type: "base64", media_type: doc.mimeType as "image/png", data } };
  throw new AppError(`${doc.name}: only PDF and image files can be read (PNG, JPEG, GIF, WebP).`, "validation");
}

/**
 * Reads documents and returns data matching `schema` (structured outputs: the response is validated
 * against the schema). A safety decline is retried on Anthropic's recommended fallback model.
 */
export async function readDocuments<S extends z.ZodType>(opts: { system: string; instructions: string; documents: AiDocument[]; schema: S }): Promise<AiResult<z.infer<S>>> {
  const content: Anthropic.Beta.BetaContentBlockParam[] = [...opts.documents.map(documentBlock), { type: "text", text: opts.instructions }];
  let response;
  try {
    response = await anthropic().beta.messages.parse({
      model: AI_MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: opts.system,
      messages: [{ role: "user", content }],
      output_config: { format: betaZodOutputFormat(opts.schema) },
    });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) throw new AppError("The document assistant is busy. Try again in a minute.", "integration");
    if (e instanceof Anthropic.AuthenticationError) throw new AppError("The document assistant's API key was rejected. Check ANTHROPIC_API_KEY.", "integration");
    if (e instanceof Anthropic.BadRequestError) throw new AppError(`The document could not be read: ${e.message}`, "validation");
    if (e instanceof Anthropic.APIError) throw new AppError("The document assistant is unavailable right now. Enter the details manually or try again later.", "integration");
    throw e;
  }
  if (response.stop_reason === "refusal") throw new AppError("The assistant declined to read this document. Enter the details manually.", "integration");
  if (response.stop_reason === "max_tokens" || !response.parsed_output) throw new AppError("The assistant could not finish reading this document. Try a shorter file or enter the details manually.", "integration");
  return {
    data: response.parsed_output as z.infer<S>,
    model: response.model,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}
