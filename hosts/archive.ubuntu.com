export default function ({ request, target, proxy }) {
  if (!['GET', 'HEAD'].includes(request.method)) {
    return new Response('405', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  return proxy(request, target);
}
