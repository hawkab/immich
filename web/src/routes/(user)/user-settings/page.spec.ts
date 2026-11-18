import { OpenQueryParam } from '#lib/constants.ts';
import { Route } from '#lib/route.ts';
import { factory } from '#test/unit/factories.ts';
import { test } from '#test/unit/fixtures.ts';
import { PartnerDirection } from '@immich/sdk';
import { expect } from 'vitest';
import { page } from 'vitest/browser';
import Page from './+page.svelte';
import { load } from './+page.ts';

test('links to the OAuth account management page', async ({ data, router, render, app }) => {
  data.user.oauthId = 'oauth-user';
  data.userConfig.oauth.enabled = true;
  data.userConfig.oauth.accountManagementUrl = 'https://idp.example/account';
  await router.goto(Route.userSettings({ isOpen: OpenQueryParam.OAUTH }));

  await render(Page, load);

  await expect.element(app.settings.manageOauthAccountLink).toHaveAttribute('href', 'https://idp.example/account');
});

test('grants and revokes outgoing partner editing independently of incoming grants', async ({
  data,
  router,
  render,
  settle,
  api,
}) => {
  const partner = factory.user({ name: 'Alice' });
  let canEdit = false;
  api.on({
    getClusterGroupUsers: () => ({ json: [data.user] }),
    getClusterGroupRequestsForGroup: () => ({ json: [] }),
    getClusterGroupRequests: () => ({ json: [] }),
    searchUsers: () => ({ json: [partner] }),
    getPartners: ({ params }) => ({
      json: [{ ...partner, canEdit: params.direction !== PartnerDirection.SharedBy || canEdit }],
    }),
    updatePartnerPermissions: ({ body }) => {
      canEdit = body.canEdit ?? false;
      return { json: { ...partner, canEdit } };
    },
  });
  await router.goto(Route.userSettings({ isOpen: OpenQueryParam.SHARING }));
  await render(Page, load);
  await page.getByRole('button', { name: 'partners', exact: false }).click();
  const edit = page.getByRole('switch', { name: 'partner_allow_editing', exact: true });
  await expect.element(edit).not.toBeChecked();
  await edit.click();
  await settle();
  expect(api.updatePartnerPermissions).toHaveBeenCalledWith({ params: { id: partner.id }, body: { canEdit: true } });
  await expect.element(edit).toBeChecked();
  expect(api.updatePartner).not.toHaveBeenCalled();
  await edit.click();
  await settle();
  expect(api.updatePartnerPermissions).toHaveBeenCalledWith({ params: { id: partner.id }, body: { canEdit: false } });
});

test('does not offer a grant to an incoming-only partner', async ({ data, router, render, api }) => {
  const partner = factory.user({ name: 'Alice' });
  api.on({
    getClusterGroupUsers: () => ({ json: [data.user] }),
    getClusterGroupRequestsForGroup: () => ({ json: [] }),
    getClusterGroupRequests: () => ({ json: [] }),
    searchUsers: () => ({ json: [partner] }),
    getPartners: ({ params }) => ({
      json: params.direction === PartnerDirection.SharedWith ? [{ ...partner, canEdit: true }] : [],
    }),
  });
  await router.goto(Route.userSettings({ isOpen: OpenQueryParam.SHARING }));
  await render(Page, load);
  await page.getByRole('button', { name: 'partners', exact: false }).click();
  await expect
    .element(page.getByRole('switch', { name: 'partner_allow_editing', exact: true }))
    .not.toBeInTheDocument();
});

test('lets the owner grant and revoke partner deletion independently of timeline settings', async ({
  data,
  router,
  render,
  settle,
  api,
}) => {
  const partner = factory.user({ name: 'Alice' });
  let canDelete = false;
  api.on({
    getClusterGroupUsers: () => ({ json: [data.user] }),
    getClusterGroupRequestsForGroup: () => ({ json: [] }),
    getClusterGroupRequests: () => ({ json: [] }),
    searchUsers: () => ({ json: [partner] }),
    getPartners: ({ params }) => ({
      json: [{ ...partner, canDelete: params.direction === PartnerDirection.SharedBy && canDelete }],
    }),
    updatePartnerPermissions: ({ body }) => {
      canDelete = body.canDelete ?? false;
      return { json: { ...partner, canDelete } };
    },
  });
  await router.goto(Route.userSettings({ isOpen: OpenQueryParam.SHARING }));
  await render(Page, load);
  await page.getByRole('button', { name: 'partners', exact: false }).click();
  const grant = page.getByRole('switch', { name: 'partner_allow_deletion', exact: true });
  await expect.element(grant).not.toBeChecked();
  await grant.click();
  await settle();
  expect(api.updatePartnerPermissions).toHaveBeenCalledWith({ params: { id: partner.id }, body: { canDelete: true } });
  await expect.element(grant).toBeChecked();
  expect(api.updatePartner).not.toHaveBeenCalled();
  await grant.click();
  await settle();
  expect(api.updatePartnerPermissions).toHaveBeenCalledWith({ params: { id: partner.id }, body: { canDelete: false } });
});
