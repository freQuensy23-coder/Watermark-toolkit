const EXPECTED_AUDIENCE = 'watermark-toolkit-deployer';
const EXPECTED_REPOSITORY = 'freQuensy23-coder/Watermark-toolkit';
const EXPECTED_REPOSITORY_ID = '1346650339';
const EXPECTED_OWNER_ID = '64750224';
const TARGET_SCRIPT = 'watermark-toolkit';
const CLOUDFLARE_API = 'https://api.cloudflare.com/client/v4';

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function parseJsonSegment(segment) {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(segment)));
}

async function verifyGitHubOidc(token, expectedSha) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed OIDC token');
  const header = parseJsonSegment(parts[0]);
  const payload = parseJsonSegment(parts[1]);
  if (header.alg !== 'RS256' || !header.kid) throw new Error('Unsupported OIDC token');

  const jwksResponse = await fetch('https://token.actions.githubusercontent.com/.well-known/jwks', {
    headers: { Accept: 'application/json' }
  });
  if (!jwksResponse.ok) throw new Error('Unable to load GitHub OIDC keys');
  const jwks = await jwksResponse.json();
  const jwk = jwks.keys?.find((key) => key.kid === header.kid && key.kty === 'RSA');
  if (!jwk) throw new Error('Unknown GitHub OIDC signing key');

  const key = await crypto.subtle.importKey(
    'jwk', jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['verify']
  );
  const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const valid = await crypto.subtle.verify(
    { name: 'RSASSA-PKCS1-v1_5' }, key, decodeBase64Url(parts[2]), data
  );
  if (!valid) throw new Error('Invalid GitHub OIDC signature');

  const now = Math.floor(Date.now() / 1000);
  const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (payload.iss !== 'https://token.actions.githubusercontent.com') throw new Error('Wrong OIDC issuer');
  if (!audience.includes(EXPECTED_AUDIENCE)) throw new Error('Wrong OIDC audience');
  if (!payload.exp || payload.exp < now - 30) throw new Error('Expired OIDC token');
  if (payload.nbf && payload.nbf > now + 30) throw new Error('OIDC token not active');
  if (payload.repository !== EXPECTED_REPOSITORY) throw new Error('Wrong repository');
  if (String(payload.repository_id) !== EXPECTED_REPOSITORY_ID) throw new Error('Wrong repository id');
  if (String(payload.repository_owner_id) !== EXPECTED_OWNER_ID) throw new Error('Wrong repository owner');
  if (payload.ref !== 'refs/heads/main') throw new Error('Only main may deploy');
  if (payload.sha !== expectedSha) throw new Error('Commit SHA mismatch');
  return payload;
}

async function cfJson(url, options, token) {
  const response = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) }
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.success === false) {
    const message = body?.errors?.map((e) => e.message).filter(Boolean).join('; ') || `HTTP ${response.status}`;
    throw new Error(`Cloudflare API: ${message}`);
  }
  return body;
}

async function uploadWorker(accountId, apiToken, source) {
  if (!source.includes('Watermark Toolkit production bundle.')) throw new Error('Unexpected deployment artifact');
  if (source.length > 750_000) throw new Error('Deployment artifact is too large');

  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify({
    main_module: 'worker.mjs',
    compatibility_date: '2026-08-26'
  })], { type: 'application/json' }), 'metadata.json');
  form.append('worker.mjs', new Blob([source], { type: 'application/javascript+module' }), 'worker.mjs');

  await cfJson(`${CLOUDFLARE_API}/accounts/${accountId}/workers/scripts/${TARGET_SCRIPT}`, {
    method: 'PUT', body: form
  }, apiToken);
  await cfJson(`${CLOUDFLARE_API}/accounts/${accountId}/workers/scripts/${TARGET_SCRIPT}/subdomain`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: true, previews_enabled: false })
  }, apiToken);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health') {
      return Response.json({ ok: true, repository: EXPECTED_REPOSITORY, target: TARGET_SCRIPT });
    }
    if (url.pathname !== '/deploy' || request.method !== 'POST') {
      return new Response('Not Found', { status: 404 });
    }

    try {
      const auth = request.headers.get('Authorization') || '';
      if (!auth.startsWith('Bearer ')) throw new Error('Missing GitHub OIDC token');
      const sha = request.headers.get('X-GitHub-Sha') || '';
      if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('Invalid commit SHA');
      await verifyGitHubOidc(auth.slice(7), sha);
      const source = await request.text();
      await uploadWorker(env.CF_ACCOUNT_ID, env.CF_API_TOKEN, source);
      return Response.json({ ok: true, sha, target: TARGET_SCRIPT });
    } catch (error) {
      console.error(error);
      return Response.json({ ok: false, error: String(error?.message || error) }, { status: 403 });
    }
  }
};
