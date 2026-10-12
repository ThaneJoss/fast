function allows(target, method) {
  const match = target.pathname.match(/^\/([A-Za-z0-9][A-Za-z0-9-]*)\/([A-Za-z0-9._-]+)\/(info\/refs|git-upload-pack)$/);
  if (!match || match[2] === '.' || match[2] === '..' || match[2] === '.git') return false;

  return (method === 'GET' && match[3] === 'info/refs' && target.search === '?service=git-upload-pack')
    || (method === 'POST' && match[3] === 'git-upload-pack' && !target.search);
}

export default function ({ request, target, proxy }) {
  if (request.method === 'POST'
    && !/^application\/x-git-upload-pack-request(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) {
    return new Response(null, { status: 403 });
  }
  return proxy(request, target, allows);
}
