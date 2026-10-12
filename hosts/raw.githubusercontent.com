function allows(target, method) {
  return (method === 'GET' || method === 'HEAD')
    && !target.search
    && /^\/nvm-sh\/nvm\/v\d+\.\d+\.\d+\/(install\.sh|nvm\.sh|nvm-exec|bash_completion)$/.test(target.pathname);
}

export default function ({ request, target, proxy }) {
  return proxy(request, target, allows);
}
