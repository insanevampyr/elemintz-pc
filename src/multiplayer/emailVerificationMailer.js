import nodemailer from "nodemailer";

const EMAIL_VERIFICATION_SUBJECT = "Verify your EleMintz account";

function parseSecureFlag(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  return null;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function readEmailVerificationSmtpConfig(env = process.env) {
  const host = String(env?.SMTP_HOST ?? "").trim();
  const port = Number(env?.SMTP_PORT);
  const secure = parseSecureFlag(env?.SMTP_SECURE);
  const user = String(env?.SMTP_USER ?? "").trim();
  const pass = String(env?.SMTP_PASS ?? "");
  const from = String(env?.EMAIL_FROM ?? "").trim();

  if (!host || !Number.isInteger(port) || port <= 0 || port > 65535 || secure === null || !user || !pass || !from) {
    return null;
  }

  return {
    host,
    port,
    secure,
    auth: {
      user,
      pass
    },
    from
  };
}

export function buildEmailVerificationMessage({ to, code, from }) {
  const safeCode = String(code ?? "").trim();
  const safeRecipient = String(to ?? "").trim();
  if (!safeCode || !safeRecipient || !from) {
    throw new Error("Verification email data is incomplete.");
  }

  const text = `Your EleMintz verification code is:

${safeCode}

Enter this code in EleMintz to verify your email.

This code expires soon. If you did not request this, you can ignore this email.`;
  const htmlCode = escapeHtml(safeCode);
  const html = `
    <div style="background:#0a1724;color:#eef7ff;font-family:Arial,sans-serif;padding:24px;line-height:1.5">
      <h1 style="color:#f2c66d;font-size:22px;margin:0 0 16px">Verify your EleMintz account</h1>
      <p>Your EleMintz verification code is:</p>
      <p style="background:#13283a;border:1px solid #52718a;border-radius:6px;color:#ffffff;font-family:monospace;font-size:20px;letter-spacing:1px;padding:12px;word-break:break-all">${htmlCode}</p>
      <p>Enter this code in EleMintz to verify your email.</p>
      <p style="color:#b8c7d3">This code expires soon. If you did not request this, you can ignore this email.</p>
    </div>
  `.trim();

  return {
    from,
    to: safeRecipient,
    subject: EMAIL_VERIFICATION_SUBJECT,
    text,
    html
  };
}

export function createEmailVerificationMailer({
  env = process.env,
  transportFactory = (options) => nodemailer.createTransport(options)
} = {}) {
  return {
    isConfigured() {
      return Boolean(readEmailVerificationSmtpConfig(env));
    },

    async sendVerificationEmail({ to, code } = {}) {
      const config = readEmailVerificationSmtpConfig(env);
      if (!config) {
        const error = new Error("Email delivery is not configured.");
        error.code = "EMAIL_DELIVERY_NOT_CONFIGURED";
        throw error;
      }

      try {
        const transport = transportFactory({
          host: config.host,
          port: config.port,
          secure: config.secure,
          auth: config.auth
        });
        await transport.sendMail(
          buildEmailVerificationMessage({
            to,
            code,
            from: config.from
          })
        );
      } catch {
        const error = new Error("Unable to send verification email. Please try again.");
        error.code = "EMAIL_VERIFICATION_DELIVERY_FAILED";
        throw error;
      }
    }
  };
}
