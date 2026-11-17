// The content is api/portfolio.json, the same file the ASP.NET Core API serves, bundled in at build time.
// Pages clones the whole repo, so the path outside web/ resolves there too.
import data from '../../../api/portfolio.json';

// Same rules the .NET records enforce at boot. This runs when the Functions bundle starts, so a broken file
// fails the deployment instead of a visitor.
const p = data as unknown as Record<string, any>;
const str = (v: unknown) => typeof v === 'string';
const has = (o: any, ...keys: string[]) => o != null && keys.every(k => str(o[k]));
const list = (v: unknown, ok: (x: any) => boolean) => v == null || (Array.isArray(v) && v.every(ok));
const need = (ok: boolean, what: string) => { if (!ok) throw new Error('portfolio.json: ' + what); };
need(has(p, 'name', 'role', 'heroSub'), 'name, role and heroSub are required.');
need(Array.isArray(p.stations) && p.stations.length === 7, 'needs exactly 7 stations, one per turn of the track.');
for (const s of p.stations) need(
  Number.isInteger(s?.turn) && has(s, 'short', 'title', 'sub', 'body')
  && list(s.chips, str)
  && list(s.roles, j => has(j, 'role', 'company', 'years', 'text'))
  && list(s.projects, x => has(x, 'name', 'text') && list(x.stack, str) && x.stack != null && (x.url == null || str(x.url)))
  && list(s.steps, x => has(x, 'title', 'text'))
  && list(s.links, x => has(x, 'label', 'href')),
  `station ${s?.turn} has a missing or wrong field.`);
const body = JSON.stringify(data);

export const onRequestGet: PagesFunction = () =>
  new Response(body, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public,max-age=300' } });
