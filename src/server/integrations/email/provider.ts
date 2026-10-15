/**
 * Provider-independent email interface. Implementations: Resend (production) and console
 * (development / unconfigured). Microsoft 365 (Graph) can be added by implementing the same
 * interface — see docs/INTEGRATIONS.md.
 */
export type OutboundEmail = {
  to: string[];
  subject: string;
  html: string;
  text?: string | null;
  attachments?: { filename: string; content: Buffer; contentType?: string }[];
  idempotencyKey: string;
};

export interface EmailProvider {
  readonly name: string;
  readonly configured: boolean;
  send(msg: OutboundEmail): Promise<{ id: string }>;
}

class ConsoleProvider implements EmailProvider {
  readonly name = "console";
  readonly configured = false;
  async send(msg: OutboundEmail) {
    console.info(`[email:console] to=${msg.to.join(",")} subject="${msg.subject}"\n${msg.text ?? msg.html}`);
    return { id: `console-${msg.idempotencyKey}` };
  }
}

class ResendProvider implements EmailProvider {
  readonly name = "resend";
  readonly configured = true;
  constructor(
    private apiKey: string,
    private from: string,
  ) {}
  async send(msg: OutboundEmail) {
    const { Resend } = await import("resend");
    const client = new Resend(this.apiKey);
    const { data, error } = await client.emails.send(
      {
        from: this.from,
        to: msg.to,
        subject: msg.subject,
        html: msg.html,
        text: msg.text ?? undefined,
        attachments: msg.attachments?.map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType })),
      },
      { idempotencyKey: msg.idempotencyKey.slice(0, 256) },
    );
    if (error || !data) throw new Error(`Resend error: ${error?.name ?? "unknown"} — ${error?.message ?? "no data"}`);
    return { id: data.id };
  }
}

export function getEmailProvider(): EmailProvider {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (process.env.EMAIL_PROVIDER !== "console" && key && from) return new ResendProvider(key, from);
  return new ConsoleProvider();
}
