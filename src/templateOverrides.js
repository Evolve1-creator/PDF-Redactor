// Persist per-template tuning in localStorage so batch uploads use the same saved settings.
const KEY_PREFIX = "simple_redactor_template_override_v1:";

export function loadTemplateOverride(templateKey) {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + templateKey);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveTemplateOverride(templateKey, overrideObj) {
  try {
    localStorage.setItem(KEY_PREFIX + templateKey, JSON.stringify(overrideObj));
  } catch {
    // ignore
  }
}

export function clearTemplateOverride(templateKey) {
  try {
    localStorage.removeItem(KEY_PREFIX + templateKey);
  } catch {
    // ignore
  }
}
