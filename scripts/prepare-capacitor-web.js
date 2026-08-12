const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'www');
const entries = [
  '.well-known',
  'Icons',
  'img',
  'admin.html',
  'agora-utils.js',
  'calls.html',
  'dashboard.html',
  'dm.html',
  'index.html',
  'Logout.html',
  'messages.html',
  'native-bridge.js',
  'notification-sw.js',
  'notifications.js',
  'profile.html',
  'reset-password.html',
  'resources.html',
  'signup.html',
  'update-password.html',
  'verify-otp.html',
  'global-notifications.js',
  'ringtone.js',
  'manifest.json'
];

function removeDir(target) {
  if (fs.existsSync(target)) {
    fs.rmSync(target, { recursive: true, force: true });
  }
}

function copyEntry(entry) {
  const source = path.join(root, entry);
  const target = path.join(outDir, entry);
  if (!fs.existsSync(source)) return;

  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    fs.cpSync(source, target, { recursive: true });
    return;
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

removeDir(outDir);
fs.mkdirSync(outDir, { recursive: true });
entries.forEach(copyEntry);
console.log(`Prepared Capacitor web assets in ${outDir}`);
