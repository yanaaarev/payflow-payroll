import type { VercelRequest, VercelResponse } from "@vercel/node";
import nodemailer from "nodemailer";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { to, subject, text, html } = req.body;

    if (!to || !subject || (!text && !html)) {
      return res.status(400).json({ error: "Missing required fields: to, subject, text/html" });
    }

    // ✅ normalize "to" (can be string or array)
    const recipients = Array.isArray(to) ? to.join(",") : String(to);

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_PASS, // must be an App Password
      },
    });

    const info = await transporter.sendMail({
      from: `"Payflow System" <${process.env.GMAIL_USER}>`, // ✅ show name + email
      to: recipients,
      subject,
      text: text || "", // fallback if html not provided
      html: html || text, // prefer html
    });

    console.log("Email sent:", info.messageId);

    return res.status(200).json({ success: true, messageId: info.messageId });
  } catch (err: any) {
    console.error("Email send error:", err.message, err);
    return res.status(500).json({ error: err.message || "Failed to send email" });
  }
}
