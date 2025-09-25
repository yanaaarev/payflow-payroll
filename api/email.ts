import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER, // e.g. payflow.hr@gmail.com
    pass: process.env.GMAIL_PASS, // the 16-char App Password
  },
});

// Generic send function
export async function sendEmail(to: string | string[], subject: string, html: string) {
  try {
    await transporter.sendMail({
      from: `"Insta Payflow HR/Finance" <${process.env.GMAIL_USER}>`,
      to: Array.isArray(to) ? to.join(",") : to,
      subject,
      html,
    });
    console.log(`✅ Email sent to ${to}`);
  } catch (err) {
    console.error("❌ Failed to send email:", err);
  }
}
