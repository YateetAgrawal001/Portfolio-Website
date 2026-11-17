// Unknown /api paths are 404, not the SPA's index.html.
export const onRequest: PagesFunction = () => new Response(null, { status: 404 });
