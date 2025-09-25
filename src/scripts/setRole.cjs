// src/scripts/setRole.js
const admin = require("firebase-admin");

// Load service account key JSON directly
const serviceAccount = require("../firebase/payflow-payroll-cb0f0-firebase-adminsdk-fbsvc-100bf60055.json");

// Initialize Firebase Admin SDK once
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

// CLI args: node src/scripts/setRole.js <add|remove> <role> <email>
const [, , action, role, email] = process.argv;

if (!action || !role || !email) {
  console.error("❌ Usage: node src/scripts/setRole.js <add|remove> <role> <email>");
  process.exit(1);
}

async function run() {
  try {
    // Look up the user by email
    const user = await admin.auth().getUserByEmail(email);

    // Current claims
    const currentClaims = user.customClaims || {};

    if (action === "add") {
      currentClaims[role] = true;
      await admin.auth().setCustomUserClaims(user.uid, currentClaims);
      console.log(`✅ Added role "${role}" to user ${email}`);
    } else if (action === "remove") {
      delete currentClaims[role];
      await admin.auth().setCustomUserClaims(user.uid, currentClaims);
      console.log(`✅ Removed role "${role}" from user ${email}`);
    } else {
      console.error("❌ Invalid action. Use add or remove.");
      process.exit(1);
    }
  } catch (err) {
    console.error("❌ Error:", err.message);
    process.exit(1);
  }
}

run();
