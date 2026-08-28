export function normalizeAllowedOrigin(value) {
  const candidate = String(value || "").trim();
  if (!candidate || candidate === "*") return "";
  try {
    const parsed = new URL(candidate);
    if (!["http:", "https:"].includes(parsed.protocol)) return "";
    if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) return "";
    return parsed.origin;
  } catch {
    return "";
  }
}

export function allowedOrigins(env, defaults = []) {
  const configured = String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const candidates = configured.length ? configured : defaults;
  return [...new Set(candidates.map(normalizeAllowedOrigin).filter(Boolean))];
}

export function findAllowedOrigin(requestOrigin, allowed) {
  const normalized = normalizeAllowedOrigin(requestOrigin);
  if (!normalized) return "";
  return allowed.find((allowedOrigin) => allowedOrigin === normalized) || "";
}

export function buildCorsHeaders(request, env, defaults = []) {
  const allowOrigin = findAllowedOrigin(
    request.headers.get("Origin"),
    allowedOrigins(env, defaults)
  );
  const headers = {
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-AI-Prof-Chai-Visitor, x-filename",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin"
  };
  if (allowOrigin) {
    headers["Access-Control-Allow-Origin"] = allowOrigin;
    headers["Access-Control-Allow-Credentials"] = "true";
  }
  return headers;
}
