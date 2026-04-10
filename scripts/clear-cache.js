const { execSync } = require('child_process');
try {
  execSync('rm -rf /vercel/share/v0-project/.next', { stdio: 'inherit' });
  console.log('Successfully cleared .next cache');
} catch (e) {
  console.log('Error clearing cache:', e.message);
}
