// POST stores a contact message; GET is the owner's inbox. Same contract as api/Program.cs.
interface Env { DB: D1Database; ADMIN_KEY?: string }

const LIMIT = 5;            // posts per IP per hour
const HOUR = 3600;
const MAX_BODY = 16 * 1024; // bytes, same as Kestrel's limit in the .NET API

const empty = (status: number, headers?: HeadersInit) => new Response(null, { status, headers });
const problem = (errors: Record<string, string[]>) => Response.json(
  { type: 'https://tools.ietf.org/html/rfc9110#section-15.5.1', title: 'One or more validation errors occurred.', status: 400, errors },
  { status: 400, headers: { 'Content-Type': 'application/problem+json' } });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  // Rate limit first, like the .NET limiter, so every post counts, valid or not. One upsert is atomic in D1
  // (it runs statements one at a time), so concurrent posts can't both read 4 and both get in.
  // CF-Connecting-IP is set by Cloudflare and can't be forged by the visitor.
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const now = Math.floor(Date.now() / 1000), hour = Math.floor(now / HOUR);
  const [hit] = await env.DB.batch<{ Count: number }>([
    env.DB.prepare('INSERT INTO RateLimit (Ip, Hour, Count) VALUES (?1, ?2, 1) ON CONFLICT (Ip, Hour) DO UPDATE SET Count = Count + 1 RETURNING Count').bind(ip, hour),
    env.DB.prepare('DELETE FROM RateLimit WHERE Hour < ?1').bind(hour),
  ]);
  if (hit.results[0].Count > LIMIT) return empty(429, { 'Retry-After': String((hour + 1) * HOUR - now) });

  if (!/^application\/([\w.-]+\+)?json\b/i.test(request.headers.get('Content-Type') ?? '')) return empty(415);
  if (Number(request.headers.get('Content-Length') ?? 0) > MAX_BODY) return empty(413);
  const raw = await request.arrayBuffer();
  if (raw.byteLength > MAX_BODY) return empty(413);
  let req: Record<string, unknown>;
  try {
    req = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return problem({ '': ['The request body is not valid JSON.'] });
  }
  if (req === null || typeof req !== 'object' || Array.isArray(req)) return problem({ '': ['The request body must be a JSON object.'] });

  // Same rules and messages as the DataAnnotations on ContactRequest, checked on the trimmed value
  // (the .NET version checked before trimming, so "   short   " passed the 10-character minimum).
  const errors: Record<string, string[]> = {};
  const field = (key: string, label: string, max: number, min = 0, email = false) => {
    const v = req[key];
    const err = (m: string) => (errors[label] ??= []).push(m);
    if (v != null && typeof v !== 'string') return err(`The ${label} field must be a string.`), '';
    const s = (v ?? '').trim();
    if (!s) return err(`The ${label} field is required.`), '';
    if (s.length > max || s.length < min) err(min
      ? `The field ${label} must be a string with a minimum length of ${min} and a maximum length of ${max}.`
      : `The field ${label} must be a string with a maximum length of ${max}.`);
    if (email && !isEmail(s)) err(`The ${label} field is not a valid e-mail address.`);
    return s;
  };
  const name = field('name', 'Name', 80);
  const email = field('email', 'Email', 254, 0, true);
  const message = field('message', 'Message', 4000, 10);
  if (Object.keys(errors).length) return problem(errors);

  // Honeypot: the field is hidden from people, so only bots fill it. Answer as if it worked.
  if (req.website != null && req.website !== '') return empty(202);

  await env.DB.prepare('INSERT INTO ContactMessage (Name, Email, Message) VALUES (?1, ?2, ?3)').bind(name, email, message).run();
  return empty(202);
};

// Owner's inbox: curl -H "X-Admin-Key: ..." /api/contact. 404 unless the ADMIN_KEY secret is set and matches.
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.ADMIN_KEY || !(await sameKey(env.ADMIN_KEY, request.headers.get('X-Admin-Key') ?? ''))) return empty(404);
  const { results } = await env.DB.prepare(
    'SELECT Id AS id, Name AS name, Email AS email, Message AS message, CreatedAt AS createdAt FROM ContactMessage ORDER BY Id DESC LIMIT 200').all();
  return Response.json(results, { headers: { 'Cache-Control': 'no-store' } });
};

// .NET's EmailAddressAttribute: one @, not first or last, no line breaks.
function isEmail(s: string) {
  const at = s.indexOf('@');
  return !/[\r\n]/.test(s) && at > 0 && at !== s.length - 1 && at === s.lastIndexOf('@');
}

// Constant-time compare. Hashing first makes both sides the same length, so the key's length doesn't leak either.
async function sameKey(a: string, b: string) {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([a, b].map(s => crypto.subtle.digest('SHA-256', enc.encode(s))));
  return crypto.subtle.timingSafeEqual(x, y);
}
