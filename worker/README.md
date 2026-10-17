# PERMA KEY API — Cloudflare auto-deploy

Worker source: `src/index.js`. This is the API code provided by the project owner.

## One-time setup

In GitHub, open **Settings → Secrets and variables → Actions → New repository secret** and add:

- `CLOUDFLARE_API_TOKEN`: Cloudflare API token allowed to deploy Workers and access the required account.
- `CLOUDFLARE_ACCOUNT_ID`: Cloudflare Account ID.
- `D1_DATABASE_ID`: ID of the existing D1 database named `perma-key-db`.

Keep `ADMIN_TOKEN` as a **Worker secret in Cloudflare**. This workflow intentionally does not print, replace, or sync it.

## Automatic deployment

After the secrets exist, edits to files in `worker/` pushed to `main` run the GitHub Actions deployment workflow. You can also run it from **Actions → Deploy PERMA KEY API to Cloudflare → Run workflow**.

## Important safety notes

- The workflow deploys the Worker code and binds it to the existing D1 database. It does not create or delete a database.
- First deployment can still fail if the D1 schema in the live database differs from what this Worker expects. Review the live database schema before deploying.
- This code's `schema()` creates tables if missing and inserts the four default tasks. It does not delete tables, but it expects `keys` to have the columns and constraints defined in `schema()`.
- The Worker code requires the existing Cloudflare Worker secret `ADMIN_TOKEN` to be configured.
- Do not put API tokens or `ADMIN_TOKEN` in source files or commit them to GitHub.
