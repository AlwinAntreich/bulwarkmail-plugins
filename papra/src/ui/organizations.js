// Which organisation a dialog starts with.

/**
 * The user's default organisation when it is still there, or the only one
 * there is. Otherwise none: the user picks, so a document doesn't land in a
 * shared organisation by default.
 */
export function preselect(organizations, defaultId) {
  if (defaultId && organizations.some((o) => o.id === defaultId)) return defaultId;
  return organizations.length === 1 ? organizations[0].id : null;
}

/** The organisation list, with a "choose" entry first while none is selected. */
export function organizationOptions(organizations, selected, t) {
  const options = organizations.map((o) => ({ value: o.id, label: o.name }));
  return selected ? options : [{ value: '', label: t('field.organization_choose') }, ...options];
}
