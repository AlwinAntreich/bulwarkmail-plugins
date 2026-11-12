import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { REPO, adminApi, installPlugin, uninstallPlugin, setPluginConfig, preparePage, signIn, waitForPlugin } from '../../e2e/helpers.mjs';

// Against the Papra container from test-env (http://localhost:18012), with
// the keys the seed wrote to test-env/.secrets/papra.json. The webmail needs
// PLUGIN_PROXY_PRIVATE_ORIGINS to include http://localhost:18012.

const PLUGIN = 'papra';
const PAPRA = process.env.PAPRA_URL || 'http://localhost:18012';
const SECRETS = JSON.parse(fs.readFileSync(process.env.PAPRA_SECRETS || path.join(REPO, 'test-env', '.secrets', 'papra.json'), 'utf8'));
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SLOT = `iframe[title="plugin-${PLUGIN}-slot"]`;

async function papra(pathname, init = {}) {
  const res = await fetch(`${PAPRA}${pathname}`, { ...init, headers: { Authorization: `Bearer ${SECRETS.apiKey}`, ...(init.headers || {}) } });
  if (!res.ok) throw new Error(`Papra ${pathname}: HTTP ${res.status}`);
  return res.status === 204 ? null : res.json();
}

/** Delete a document for good, with alice's session (the seeded keys can't delete). */
async function deleteDoc(organization, docId) {
  const signIn = await fetch(`${PAPRA}/api/auth/sign-in/email`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: PAPRA }, body: JSON.stringify({ email: SECRETS.email, password: SECRETS.password }),
  });
  const cookie = signIn.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const id = SECRETS.organizations[organization];
  const headers = { Cookie: cookie, Origin: PAPRA };
  await fetch(`${PAPRA}/api/organizations/${id}/documents/${docId}`, { method: 'DELETE', headers });
  await fetch(`${PAPRA}/api/organizations/${id}/documents/trash/${docId}`, { method: 'DELETE', headers });
}

/** Documents in an organisation whose name contains `text`. */
async function findDocs(organization, text) {
  const id = SECRETS.organizations[organization];
  const data = await papra(`/api/organizations/${id}/documents?searchQuery=&pageSize=100`);
  return data.documents.filter((d) => d.name.includes(text));
}

/** Mail alice a message with a PDF unique to this run. */
function sendMail(subject, pdfName) {
  execFileSync(process.env.PYTHON || 'python3', [path.join(HERE, 'send_mail.py'), '--from', 'ACME Hosting <billing@acme-hosting.example>',
    '--subject', subject, '--pdf-text', `${subject} ${Date.now()}`, '--pdf-name', pdfName], { stdio: 'pipe' });
}

/** Open a message by subject, reloading once if push hasn't brought it yet. */
async function openMessage(page, subject) {
  const row = page.getByText(subject, { exact: true }).first();
  try {
    await expect(row).toBeVisible({ timeout: 30_000 });
  } catch {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(row).toBeVisible({ timeout: 60_000 });
  }
  await row.click({ position: { x: 4, y: 4 } });
}

/** "Save to Papra" in the attachment's plugin menu: its button only takes clicks while the attachment is hovered. */
async function saveToPapra(page) {
  const menu = page.locator('[data-attachment-plugin-menu]').first();
  await menu.locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " group ")][1]').hover();
  await menu.click();
  await page.getByRole('menuitem', { name: 'Save to Papra' }).click();
}

/** Drop the user's Papra key, as the host's Disconnect does. */
async function disconnect(page) {
  await page.evaluate(() => fetch('/api/plugin-secrets?plugin=papra&credential=papra', { method: 'DELETE' }));
}

/** Connect through the host's dialogs: our "Connect Papra" question, then the host's form. */
async function connectKey(page, { key = SECRETS.apiKey, server } = {}) {
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  const form = page.getByRole('dialog', { name: /Papra/ }).last();
  const address = form.getByLabel('Server address');
  await expect(address).toHaveValue(/localhost:18012/);
  if (server) await address.fill(server);
  await form.getByLabel('Password or key').fill(key);
  await form.getByRole('button', { name: 'Connect' }).click();
}

/** A toast (the app also repeats it in a live region for screen readers). */
const toast = (page, text) => page.getByText(text).first();
const footerButton = (page, name) => page.locator('[data-plugin-dialog-buttons]').last().getByRole('button', { name, exact: true });

test.describe('papra plugin', () => {
  let admin;
  test.beforeAll(async () => {
    admin = await adminApi();
    await installPlugin(admin, PLUGIN);
    await setPluginConfig(admin, PLUGIN, 'serverUrl', PAPRA);
    await setPluginConfig(admin, PLUGIN, 'defaultTags', 'Bulwark');
  });
  test.afterAll(async () => {
    await uninstallPlugin(admin, PLUGIN);
  });

  test('connects the key to the admin\'s server and saves an attachment with tags', async ({ page }) => {
    const run = `Papra e2e ${Date.now()}`;
    const pdfName = `${run}.pdf`;
    sendMail(run, pdfName);
    await preparePage(page);
    await signIn(page);
    await waitForPlugin(page, PLUGIN);
    await disconnect(page);
    try {
      await openMessage(page, run);

      // Another server in the host's form: the key is dropped again.
      await saveToPapra(page);
      await connectKey(page, { server: 'https://example.com' });
      await expect(toast(page, 'Connect the key to localhost:18012. Other servers can\'t be used.')).toBeVisible();

      await saveToPapra(page);
      await connectKey(page);
      const dialog = page.frameLocator(SLOT).last();
      // No default organisation yet: nothing preselected, Save waits for a choice.
      await expect(dialog.getByRole('combobox')).toHaveValue('');
      await expect(footerButton(page, 'Save')).toBeDisabled();
      await dialog.getByRole('combobox').selectOption(SECRETS.organizations.Alice);
      await expect(dialog.getByText('✓ Bulwark')).toBeVisible();
      await dialog.getByRole('button', { name: /^Invoice/ }).click();
      await footerButton(page, 'Save').click();
      await expect(toast(page, `Saved ${pdfName} to Alice in Papra (tags: Bulwark, Invoice).`)).toBeVisible({ timeout: 60_000 });

      const [doc] = await findDocs('Alice', run);
      // "Open in Papra" opens the new document's page in Papra.
      const popup = page.waitForEvent('popup');
      await page.getByRole('button', { name: 'Open in Papra' }).first().click();
      const tab = await popup;
      if (tab.url() === 'about:blank') await tab.waitForURL(/^http/).catch(() => {});
      expect(tab.url()).toBe(`${PAPRA}/organizations/${SECRETS.organizations.Alice}/documents/${doc.id}`);
      await tab.close();
      expect(doc.tags.map((t) => t.name).sort()).toEqual(['Bulwark', 'Invoice']);

      // The same file again: Papra already has it.
      await saveToPapra(page);
      await dialog.getByRole('combobox').selectOption(SECRETS.organizations.Alice);
      await footerButton(page, 'Save').click();
      await expect(toast(page, `Papra already has ${pdfName}.`)).toBeVisible({ timeout: 60_000 });

      // Team has no Bulwark tag: saved without it, and the user is told.
      sendMail(`${run} team`, `${run} team.pdf`);
      await openMessage(page, `${run} team`);
      await saveToPapra(page);
      await dialog.getByRole('combobox').selectOption(SECRETS.organizations.Team);
      await expect(dialog.getByText('Not added, Team has no such tag: Bulwark')).toBeVisible();
      await footerButton(page, 'Save').click();
      await expect(toast(page, `Saved ${run} team.pdf to Team in Papra. Default tags left out, Team doesn’t have them: Bulwark`)).toBeVisible({ timeout: 60_000 });
    } finally {
      for (const org of ['Alice', 'Team']) {
        for (const doc of await findDocs(org, run).catch(() => [])) await deleteDoc(org, doc.id).catch(() => {});
      }
      await disconnect(page).catch(() => {});
    }
  });

  test('attaches documents from Papra to a new message, found by search and tag', async ({ page }) => {
    await preparePage(page);
    await signIn(page);
    await waitForPlugin(page, PLUGIN);
    await disconnect(page);
    try {
      await page.getByRole('button', { name: 'Compose' }).first().click();
      await page.getByTestId('composer-attach-menu').click();
      await page.getByRole('menuitem', { name: 'From Papra' }).click();
      await connectKey(page);
      const picker = page.frameLocator(SLOT).last();
      await picker.getByRole('combobox').first().selectOption(SECRETS.organizations.Alice);
      await expect(picker.getByText('3 documents')).toBeVisible();

      // Quick filter: only the invoice; the term shows in the search box.
      await picker.getByTitle('Add tag:"Invoice" to the search').click();
      await expect(picker.getByRole('searchbox', { name: 'Search documents' })).toHaveValue('tag:"Invoice"');
      await expect(picker.getByText('1 document', { exact: true })).toBeVisible();
      await picker.getByTitle('Remove tag:"Invoice" from the search').click();

      // Papra's own syntax, typed: either tag.
      await picker.getByRole('searchbox', { name: 'Search documents' }).fill('tag:invoice OR tag:contract');
      await expect(picker.getByText('2 documents', { exact: true })).toBeVisible();

      // Full-text search: the contract, by a word in its text.
      await picker.getByRole('searchbox', { name: 'Search documents' }).fill('Valid');
      await expect(picker.getByText('hosting-contract.pdf')).toBeVisible();
      await expect(picker.getByText('acme-invoice-2026-10.pdf')).toHaveCount(0);
      await picker.getByText('hosting-contract.pdf').click();
      await picker.getByRole('searchbox', { name: 'Search documents' }).fill('');
      await picker.getByText('acme-invoice-2026-10.pdf').click();
      await footerButton(page, 'Attach 2').click();

      await expect(toast(page, 'Attached 2 documents from Papra.')).toBeVisible({ timeout: 60_000 });
      await expect(page.getByText('hosting-contract.pdf').first()).toBeVisible();
      await expect(page.getByText('acme-invoice-2026-10.pdf').first()).toBeVisible();
    } finally {
      await disconnect(page).catch(() => {});
    }
  });

  test('saves untagged with a key that can\'t tag, and says so in the dialog', async ({ page }) => {
    const run = `Papra e2e notags ${Date.now()}`;
    sendMail(run, `${run}.pdf`);
    await preparePage(page);
    await signIn(page);
    await waitForPlugin(page, PLUGIN);
    await disconnect(page);
    try {
      await openMessage(page, run);
      await saveToPapra(page);
      await connectKey(page, { key: SECRETS.apiKeyWithoutTags });
      const dialog = page.frameLocator(SLOT).last();
      await dialog.getByRole('combobox').selectOption(SECRETS.organizations.Alice);
      await expect(dialog.getByText(/Your API key can't add tags/)).toBeVisible();
      await footerButton(page, 'Save').click();
      await expect(toast(page, `Saved ${run}.pdf to Alice in Papra.`)).toBeVisible({ timeout: 60_000 });
      const [doc] = await findDocs('Alice', run);
      expect(doc.tags).toEqual([]);
    } finally {
      for (const doc of await findDocs('Alice', run).catch(() => [])) await deleteDoc('Alice', doc.id).catch(() => {});
      await disconnect(page).catch(() => {});
    }
  });
  test('the settings page connects, sets the default organisation the dialogs preselect, and disconnects', async ({ page }) => {
    const run = `Papra e2e settings ${Date.now()}`;
    sendMail(run, `${run}.pdf`);
    await preparePage(page);
    await signIn(page);
    await waitForPlugin(page, PLUGIN);
    await disconnect(page);
    try {
      await page.getByRole('link', { name: 'Settings' }).first().click();
      await page.getByRole('button', { name: 'Papra', exact: true }).first().click({ timeout: 60_000 });
      const settings = page.frameLocator(SLOT).first();
      await expect(settings.getByText('Not connected. Connect your Papra API key for localhost:18012.')).toBeVisible({ timeout: 60_000 });
      await settings.getByRole('button', { name: 'Connect Papra' }).click();
      const form = page.getByRole('dialog', { name: /Papra/ }).last();
      await form.getByLabel('Password or key').fill(SECRETS.apiKey);
      await form.getByRole('button', { name: 'Connect' }).click();
      await expect(settings.getByText(/^Connected to localhost:18012 with the key/)).toBeVisible();
      await settings.getByRole('combobox').selectOption(SECRETS.organizations.Team);

      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await waitForPlugin(page, PLUGIN);
      await openMessage(page, run);
      await saveToPapra(page);
      const dialog = page.frameLocator(SLOT).last();
      await expect(dialog.getByRole('combobox')).toHaveValue(SECRETS.organizations.Team);
      await footerButton(page, 'Cancel').click();

      await page.getByRole('link', { name: 'Settings' }).first().click();
      await page.getByRole('button', { name: 'Papra', exact: true }).first().click({ timeout: 60_000 });
      await settings.getByRole('combobox').selectOption('');
      await settings.getByRole('button', { name: 'Disconnect' }).click();
      await expect(settings.getByRole('button', { name: 'Connect Papra' })).toBeVisible();
    } finally {
      await disconnect(page).catch(() => {});
    }
  });
  test('saves with the user\'s default properties, one changed for this document', async ({ page }) => {
    const run = `Papra e2e props ${Date.now()}`;
    sendMail(run, `${run}.pdf`);
    await preparePage(page);
    await signIn(page);
    await waitForPlugin(page, PLUGIN);
    const settingsPage = async () => {
      await page.getByRole('link', { name: 'Settings' }).first().click();
      await page.getByRole('button', { name: 'Papra', exact: true }).first().click({ timeout: 60_000 });
      return page.frameLocator(SLOT).first();
    };
    await disconnect(page);
    try {
      let settings = await settingsPage();
      await settings.getByRole('button', { name: 'Connect Papra' }).click();
      const form = page.getByRole('dialog', { name: /Papra/ }).last();
      await form.getByLabel('Password or key').fill(SECRETS.apiKey);
      await form.getByRole('button', { name: 'Connect' }).click();
      // Defaults by name: Owner is the user, Category Private.
      await settings.getByRole('button', { name: 'Add a default property' }).click();
      await settings.getByRole('button', { name: 'Owner', exact: true }).click();
      await settings.getByLabel('Default for Owner').fill('Alwin Antreich');
      await settings.getByRole('button', { name: 'Add a default property' }).click();
      await settings.getByRole('button', { name: 'Category', exact: true }).click();
      await settings.getByLabel('Default for Category').selectOption('Private');

      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await waitForPlugin(page, PLUGIN);
      await openMessage(page, run);
      await saveToPapra(page);
      const dialog = page.frameLocator(SLOT).last();
      await dialog.getByRole('combobox').first().selectOption(SECRETS.organizations.Alice);
      await dialog.getByRole('tab', { name: /^Properties/ }).click();
      // The defaults are rows, changed in place.
      await expect(dialog.getByRole('combobox', { name: 'Category' })).toHaveValue(/.+/);
      // The document belongs to someone else: change the owner for this save.
      await dialog.getByRole('textbox', { name: 'Owner' }).fill('Agata');
      await dialog.getByLabel('Add property').selectOption({ label: 'Paid (yes/no)' });
      // A date from day, month and year lists: a date field's picker doesn't open in the plugin's frame.
      await dialog.getByLabel('Add property').selectOption({ label: 'Due (date)' });
      await dialog.getByLabel('Due: day').selectOption('1');
      await dialog.getByLabel('Due: month').selectOption('12');
      await dialog.getByLabel('Due: year').selectOption('2026');
      await footerButton(page, 'Save').click();
      await expect(toast(page, `Saved ${run}.pdf to Alice in Papra (tags: Bulwark; Category: Private; Due: Dec 1, 2026; Owner: Agata; Paid: yes).`)).toBeVisible({ timeout: 60_000 });

      const [doc] = await findDocs('Alice', run);
      const values = Object.fromEntries(doc.customProperties.filter((p) => p.value !== null && p.value !== undefined).map((p) => [p.name, p.value?.name ?? p.value]));
      expect(values).toMatchObject({ Owner: 'Agata', Category: 'Private', Paid: true });
      expect(values.Due).toMatch(/^2026-12-01/);
    } finally {
      for (const doc of await findDocs('Alice', run).catch(() => [])) await deleteDoc('Alice', doc.id).catch(() => {});
      const settings = await settingsPage().catch(() => null);
      for (const name of ['Owner', 'Category']) await settings?.getByRole('button', { name: `Remove ${name}` }).click({ timeout: 5_000 }).catch(() => {});
      await disconnect(page).catch(() => {});
    }
  });
});
