const HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&#x2f;": "/",
  "&quot;": "\"",
  "&#39;": "'"
};

export function decodeHtmlEntitiesOnce(value: string) {
  return value.replace(
    /&(amp|quot|#39|#x2f);/gi,
    (entity) => HTML_ENTITIES[entity.toLowerCase()] || entity
  );
}
