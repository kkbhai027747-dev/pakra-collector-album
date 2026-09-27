import { createHmac, timingSafeEqual } from 'node:crypto';

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const unauthorized = () => new ApiError(401, 'authentication_required', 'Please sign in and try again.');

function hmac(secret, value) {
  return createHmac('sha256', secret).update(value).digest('hex');
}

function equalHex(left, right) {
  if (!/^[a-f\d]{64}$/i.test(left)) return false;
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

export function authenticateProxy(url, {
  secret,
  shop,
  now = Date.now(),
  prefix = '/apps/pakra-collection',
  maxAgeSeconds = 300,
}) {
  const parameters = new Map();
  for (const [key, value] of url.searchParams) {
    const values = parameters.get(key) ?? [];
    values.push(value);
    parameters.set(key, values);
  }
  for (const key of ['signature', 'shop', 'timestamp', 'logged_in_customer_id', 'path_prefix']) {
    if (parameters.get(key)?.length !== 1) throw unauthorized();
  }
  const signature = parameters.get('signature')[0];
  parameters.delete('signature');
  const message = [...parameters]
    .map(([key, values]) => `${key}=${values.join(',')}`)
    .sort()
    .join('');
  if (!equalHex(signature, hmac(secret, message))) throw unauthorized();

  const customerId = parameters.get('logged_in_customer_id')[0];
  const timestamp = parameters.get('timestamp')[0];
  const timestampSeconds = Number(timestamp);
  const currentSeconds = Math.floor(now / 1000);
  if (
    parameters.get('shop')[0] !== shop ||
    parameters.get('path_prefix')[0] !== prefix ||
    !/^[1-9]\d{0,24}$/.test(customerId) ||
    !/^\d{1,12}$/.test(timestamp) ||
    !Number.isSafeInteger(timestampSeconds) ||
    timestampSeconds < currentSeconds - maxAgeSeconds ||
    timestampSeconds > currentSeconds + 30
  ) throw unauthorized();

  return { shop, customerId };
}

function csrfMessage(principal, expires) {
  return JSON.stringify(['pakra-collection-csrf-v1', principal.shop, principal.customerId, expires]);
}

export function issueCsrfToken(principal, secret, now = Date.now()) {
  const expires = Math.floor(now / 1000) + 900;
  return `${expires}.${hmac(secret, csrfMessage(principal, expires))}`;
}

export function verifyCsrfToken(token, principal, secret, now = Date.now()) {
  const match = typeof token === 'string' && /^(\d{1,12})\.([a-f\d]{64})$/i.exec(token);
  if (match) {
    const expires = Number(match[1]);
    const currentSeconds = Math.floor(now / 1000);
    if (
      expires > currentSeconds &&
      expires <= currentSeconds + 900 &&
      equalHex(match[2], hmac(secret, csrfMessage(principal, expires)))
    ) return;
  }
  throw new ApiError(403, 'invalid_csrf', 'Refresh your collection before saving.');
}
