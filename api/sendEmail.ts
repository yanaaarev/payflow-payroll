import type { VercelRequest, VercelResponse } from "@vercel/node";
import nodemailer from "nodemailer";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { to, subject, text, html } = req.body; // 👈 also accept html

  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_PASS, // App password, not normal Gmail password
      },
    });

    await transporter.sendMail({
      from: `"InstaPayFlow HR" <${process.env.GMAIL_USER}>`,
      to,
      subject,
      text: text || "",   // fallback in case html not provided
      html: html || text, // 👈 use html when provided
    });

    res.status(200).json({ success: true });
  } catch (err) {
    console.error("Email send error:", err);
    res.status(500).json({ error: "Failed to send email" });
  }
}
