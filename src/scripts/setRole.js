// scripts/setRole.js
// Usage:
//   node scripts/setRole.js add admin someone@company.com
//   node scripts/setRole.js add finance finance@company.com
//   node scripts/setRole.js add exec exec@company.com
//   node scripts/setRole.js remove admin someone@company.com
//   node scripts/setRole.js show someone@company.com

import fs from 'node:fs';
import path from 'node:path';
import admin from 'firebase-admin';

const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || path.resolve('./service-account.json');
if (!fs.existsSync(credPath)) {
  console.error('Service account file not found:', credPath);
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(fs.readFileSync(credPath, 'utf8')))
});

const auth = admin.auth();

function ensureArray(x) {
  return Array.isArray(x) ? x : (x ? [x] : []);
}

async function getUserByEmail(email) {
  try {
    return await auth.getUserByEmail(email);
  } catch (e) {
    console.error('User not found for email:', email);
    process.exit(1);
  }
}

async function addRole(email, role) {
  const user = await getUserByEmail(email);
  const claims = user.customClaims || {};
  const roles = ensureArray(claims.roles);
  if (!roles.includes(role)) roles.push(role);
  await auth.setCustomUserClaims(user.uid, { ...claims, roles });
  console.log(`Added role "${role}" to ${email}. New roles:`, roles);
}

async function removeRole(email, role) {
  const user = await getUserByEmail(email);
  const claims = user.customClaims || {};
  const roles = ensureArray(claims.roles).filter(r => r !== role);
  await auth.setCustomUserClaims(user.uid, { ...claims, roles });
  console.log(`Removed role "${role}" from ${email}. New roles:`, roles);
}

async function show(email) {
  const user = await getUserByEmail(email);
  console.log('Claims for', email, user.customClaims || {});
}

const [cmd, roleOrEmail, maybeEmail] = process.argv.slice(2);
(async () => {
  try {
    if (cmd === 'add') {
      if (!maybeEmail) throw new Error('Usage: node scripts/setRole.js add <role> <email>');
      await addRole(maybeEmail, roleOrEmail);
    } else if (cmd === 'remove') {
      if (!maybeEmail) throw new Error('Usage: node scripts/setRole.js remove <role> <email>');
      await removeRole(maybeEmail, roleOrEmail);
    } else if (cmd === 'show') {
      await show(roleOrEmail);
    } else {
      console.log(`Commands:
  add <role> <email>     # add a role (admin|finance|exec)
  remove <role> <email>  # remove a role
  show <email>           # show current claims`);
    }
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
