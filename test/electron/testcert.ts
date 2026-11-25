// A throwaway certificate for the checks' own https pages (QA fix F9, 2026-11-25): made once per run in a temp folder,
// so no check needs TEST_CERT_DIR set by hand. Uses openssl, as autofill-check.ts already does (Git Bash has it on Windows).
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function testCert(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'samara-cert-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(dir, 'test-key.pem'), '-out', path.join(dir, 'test-cert.pem'),
    '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,DNS:shop.example,IP:127.0.0.1'], { stdio: 'ignore' });
  return dir;
}
