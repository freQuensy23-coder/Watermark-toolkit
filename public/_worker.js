const ACCOUNT_ID = 'd2d7316343442d7041e7d705149bd373';
const PROJECT_NAME = 'watermark-toolkit';
const EXPECTED_AUDIENCE = 'watermark-toolkit-cd';
const EXPECTED_REPOSITORY = 'freQuensy23-coder/Watermark-toolkit';
const EXPECTED_REPOSITORY_ID = '1346650339';
const EXPECTED_OWNER_ID = '64750224';
const CLOUDFLARE_API = 'https://api.cloudflare.com/client/v4';

let jwksCache = null;
let jwksCacheUntil = 0;

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  const raw = atob(padded);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

function parseJwtSegment(segment) {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(segment)));
}

async function getGithubJwks() {
  const now = Date.now();
  if (jwksCache && now < jwksCacheUntil) return jwksCache;
  const response = await fetch('https://token.actions.githubusercontent.com/.well-known/jwks', {
    headers: { Accept: 'application/json' }
  });
  if (!response.ok) throw new Error('Unable to load GitHub OIDC signing keys');
  const body = await response.json();
  if (!Array.isArray(body.keys)) throw new Error('Invalid GitHub OIDC key set');
  jwksCache = body.keys;
  jwksCacheUntil = now + 10 * 60 * 1000;
  return jwksCache;
}

async function verifyGithubOidc(token, expectedSha) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed OIDC token');
  const header = parseJwtSegment(parts[0]);
  const payload = parseJwtSegment(parts[1]);
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') {
    throw new Error('Unsupported OIDC token');
  }

  const keys = await getGithubJwks();
  const jwk = keys.find((key) => key.kid === header.kid && key.kty === 'RSA');
  if (!jwk) throw new Error('Unknown GitHub OIDC signing key');
  const key = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );
  const signedData = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const signatureValid = await crypto.subtle.verify(
    { name: 'RSASSA-PKCS1-v1_5' },
    key,
    decodeBase64Url(parts[2]),
    signedData
  );
  if (!signatureValid) throw new Error('Invalid GitHub OIDC signature');

  const now = Math.floor(Date.now() / 1000);
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (payload.iss !== 'https://token.actions.githubusercontent.com') throw new Error('Wrong OIDC issuer');
  if (!audiences.includes(EXPECTED_AUDIENCE)) throw new Error('Wrong OIDC audience');
  if (!Number.isFinite(payload.exp) || payload.exp < now - 30) throw new Error('Expired OIDC token');
  if (Number.isFinite(payload.nbf) && payload.nbf > now + 30) throw new Error('OIDC token is not active');
  if (Number.isFinite(payload.iat) && payload.iat > now + 30) throw new Error('OIDC issued in the future');
  if (payload.repository !== EXPECTED_REPOSITORY) throw new Error('Wrong repository');
  if (String(payload.repository_id) !== EXPECTED_REPOSITORY_ID) throw new Error('Wrong repository id');
  if (String(payload.repository_owner_id) !== EXPECTED_OWNER_ID) throw new Error('Wrong repository owner');
  if (payload.ref !== 'refs/heads/main') throw new Error('Only main may deploy');
  if (payload.sha !== expectedSha) throw new Error('Commit SHA mismatch');
  if (payload.event_name !== 'push' && payload.event_name !== 'workflow_dispatch') {
    throw new Error('Unsupported GitHub event');
  }
  return payload;
}

async function triggerPagesDeployment(apiToken, expectedSha) {
  const response = await fetch(
    `${CLOUDFLARE_API}/accounts/${ACCOUNT_ID}/pages/projects/${PROJECT_NAME}/deployments`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json'
      },
      body: '{}'
    }
  );
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.success === false || !body?.result) {
    const message = body?.errors?.map((error) => error.message).filter(Boolean).join('; ');
    throw new Error(message || `Cloudflare deployment API returned ${response.status}`);
  }
  const deployment = body.result;
  const commit = deployment.deployment_trigger?.metadata?.commit_hash || null;
  if (commit && commit !== expectedSha) {
    throw new Error(`Cloudflare selected unexpected commit ${commit}`);
  }
  return {
    id: deployment.id,
    url: deployment.url,
    commit,
    environment: deployment.environment,
    stage: deployment.latest_stage?.name || null
  };
}

function jsonResponse(value, status = 200) {
  return Response.json(value, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Watermark-Toolkit-Worker': '1'
    }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/__health') {
      return jsonResponse({ ok: true, deployConfigured: Boolean(env.CF_PAGES_TOKEN) });
    }

    if (url.pathname === '/__deploy') {
      if (request.method !== 'POST') return jsonResponse({ ok: false, error: 'Method not allowed' }, 405);
      try {
        const authorization = request.headers.get('Authorization') || '';
        if (!authorization.startsWith('Bearer ')) throw new Error('Missing GitHub OIDC token');
        const sha = request.headers.get('X-GitHub-Sha') || '';
        if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('Invalid commit SHA');
        if (typeof env.CF_PAGES_TOKEN !== 'string' || env.CF_PAGES_TOKEN.length < 40) {
          throw new Error('Deployment secret is not configured');
        }
        await verifyGithubOidc(authorization.slice(7), sha);
        const deployment = await triggerPagesDeployment(env.CF_PAGES_TOKEN, sha);
        return jsonResponse({ ok: true, sha, deployment });
      } catch (error) {
        console.error('Deployment trigger rejected:', error);
        return jsonResponse({ ok: false, error: String(error?.message || error) }, 403);
      }
    }

    const response = await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);
    headers.set('X-Watermark-Toolkit-Worker', '1');
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Referrer-Policy', 'no-referrer');
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }
};
