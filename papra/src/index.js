// Papra for Bulwark: save attachments to Papra and attach Papra documents
// to new mail. See README.md, and docs/ for the plan and how it is built.

import { createElement as h } from 'react';
import { createBackground } from './lib/background.js';
import { setApi } from './ui/host.js';
import { SaveDialog } from './ui/SaveDialog.jsx';
import { PickDialog } from './ui/PickDialog.jsx';
import { Settings } from './ui/Settings.jsx';

let background = null;

export async function activate(api) {
  setApi(api);
  background = createBackground(api);
  await background.registerUi();
  api.i18n.onLocaleChange(() => { void background.registerUi(); });
}

// Hooks answer at once; the work runs on (the host gives up on slow hooks
// and turns off plugins whose hooks keep failing).
export const hooks = {
  onAction(event) {
    if (background) void Promise.resolve(background.onAction(event)).catch(() => {});
  },
};

function Dialog(props) {
  if (props.view === 'save') return h(SaveDialog, props);
  if (props.view === 'pick') return h(PickDialog, props);
  return null;
}

export const slots = {
  'plugin-dialog': { component: Dialog },
  'settings-section': { component: () => h(Settings, {}) },
};
