export default function ({ request, target, proxy }) {
  return proxy(request, target);
}
