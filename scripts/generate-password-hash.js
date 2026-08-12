// Run this locally whenever you need to set or change the admin password:
//   node scripts/generate-password-hash.js
// It never writes to disk or sends the password anywhere - it just prints
// the bcrypt hash you paste into .env as ADMIN_PASSWORD_HASH. The plain
// password itself is never stored, so keep it somewhere safe (password
// manager) - if you forget it, generate a new hash instead of trying to
// recover it.
import bcrypt from 'bcryptjs';
import readline from 'readline';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

rl.question('Enter the admin password to hash: ', async (password) => {
  if (!password || password.length < 8) {
    console.log('\nPlease use a password with at least 8 characters.');
    rl.close();
    return;
  }

  const hash = await bcrypt.hash(password, 12);
  console.log('\nAdd this line to your .env file (replacing any existing value):\n');
  console.log(`ADMIN_PASSWORD_HASH=${hash}\n`);
  rl.close();
});