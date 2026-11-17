// Runs in front of every /api function: the same security headers the ASP.NET Core API sends, and no stack traces out.
export const onRequest: PagesFunction = async ({ next }) => {
  let res: Response;
  try {
    res = await next();
  } catch (e) {
    console.error(e);
    res = new Response(null, { status: 500 });
  }
  res = new Response(res.body, res); // responses can be immutable; copy before adding headers
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.headers.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  return res;
};
