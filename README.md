# vinext-starter

A clean full-stack starter running on
[vinext](https://github.com/cloudflare/vinext), with optional Cloudflare D1 and
Drizzle support.

## Prerequisites

- Node.js `>=22.13.0`

## Quick Start

```bash
npm install
npm run dev
npm run build
```

## VPS Shared Inventory Setup

This app stores shared inventory data in a server-side SQLite file when it runs
on a VPS.

Required production environment variables:

```bash
SESSION_SECRET="change-this-long-random-secret"
DATABASE_PATH="./data/materials.sqlite"
BOOTSTRAP_ADMIN_USERNAME="admin"
BOOTSTRAP_ADMIN_PASSWORD="change-this-admin-password"
BOOTSTRAP_ADMIN_NAME="系统管理员"
```

Make sure the `data/` directory is writable by the process that runs
`npm run start`. If `DATABASE_PATH` is omitted, the app uses
`./data/materials.sqlite`.

On first startup, the app creates the first enabled system administrator from
`BOOTSTRAP_ADMIN_USERNAME`, `BOOTSTRAP_ADMIN_PASSWORD`, and
`BOOTSTRAP_ADMIN_NAME`. If `BOOTSTRAP_ADMIN_PASSWORD` is omitted, the app falls
back to the older `APP_PASSWORD` value so existing VPS deployments can still
create the initial administrator during upgrade.

After the first administrator exists, manage users from the in-app `用户管理`
page instead of editing `.env`.

User roles:

- `系统管理员`: manage users, view operation logs, run manual backups, reset demo data, and perform all material workflows.
- `物料管理员`: manage inventory, usage records, reservations, and reservation receipt status.
- `普通用户`: create usage records and warehouse reservations, and view inventory data.
- `只读用户`: view inventory, records, and reservation lists only.

All signed-in users can change their own password from the top action bar.
Operation logs record sign-in, sign-out, password changes, user management,
inventory, usage, reservation, backup, and other key actions. Only system
administrators can view operation logs in the app.

## Weekly Database Backup

The VPS can send a weekly database backup email every Monday at 08:00 China
time. The backup includes a recoverable SQLite snapshot and a readable JSON
export of materials, usage records, and reservation records.

Configure these environment variables on the VPS:

```bash
BACKUP_SMTP_HOST="smtp.gmail.com"
BACKUP_SMTP_PORT="465"
BACKUP_SMTP_USER="your-sender@gmail.com"
BACKUP_SMTP_PASS="your-gmail-app-password"
BACKUP_EMAIL_TO="kerorosen@gmail.com"
BACKUP_PASSWORD="change-this-backup-password"
```

Use a Gmail app password for `BACKUP_SMTP_PASS`; do not use the normal Gmail
login password.

Run one backup manually:

```bash
npm run backup:database
```

Generate backup files without sending email, useful for local verification:

```bash
BACKUP_DRY_RUN=1 npm run backup:database
```

Example VPS cron entry for Monday 08:00 China time:

```cron
TZ=Asia/Shanghai
0 8 * * 1 cd /path/to/app && npm run backup:database >> ./backups/backup.log 2>&1
```

The in-app `备份数据库` button uses the same SMTP configuration and sends the
same backup attachments to `kerorosen@gmail.com`. It also requires
`BACKUP_PASSWORD` before the email is sent. The weekly cron backup does not
need this password because it runs directly on the VPS.

The backup script also reads `.env` from the project directory when variables
are not already provided by the running process. After changing `.env`, restart
the web app service so the in-app backup button uses the latest settings.

This starter does not use `wrangler.jsonc`.

## Included Shape

- edit site code under `app/`
- `.openai/hosting.json` declares optional Sites D1 and R2 bindings
- `vite.config.ts` simulates declared bindings for local development
- `db/schema.ts` starts intentionally empty
- `examples/d1/` contains an optional D1 example surface
- `drizzle.config.ts` supports local migration generation when needed

## Workspace Auth Headers

OpenAI workspace sites can read the current user's email from
`oai-authenticated-user-email`.

SIWC-authenticated workspace sites may also receive
`oai-authenticated-user-full-name` when the user's SIWC profile has a non-empty
`name` claim. The full-name value is percent-encoded UTF-8 and is accompanied by
`oai-authenticated-user-full-name-encoding: percent-encoded-utf-8`.

Treat the full name as optional and fall back to email when it is absent:

```tsx
import { headers } from "next/headers";

export default async function Home() {
  const requestHeaders = await headers();
  const email = requestHeaders.get("oai-authenticated-user-email");
  const encodedFullName = requestHeaders.get("oai-authenticated-user-full-name");
  const fullName =
    encodedFullName &&
    requestHeaders.get("oai-authenticated-user-full-name-encoding") ===
      "percent-encoded-utf-8"
      ? decodeURIComponent(encodedFullName)
      : null;

  const displayName = fullName ?? email;
  // ...
}
```

## Optional Dispatch-Owned ChatGPT Sign-In

Import the ready-to-use helpers from `app/chatgpt-auth.ts` when the site needs
optional or required ChatGPT sign-in:

- Use `getChatGPTUser()` for optional signed-in UI.
- Use `requireChatGPTUser(returnTo)` for server-rendered pages that should send
  anonymous visitors through Sign in with ChatGPT.
- Use `chatGPTSignInPath(returnTo)` and `chatGPTSignOutPath(returnTo)` for
  browser links or actions.
- Pass a same-origin relative `returnTo` path for the destination after sign-in
  or sign-out. The helper validates and safely encodes it.
- Mark protected pages with `export const dynamic = "force-dynamic"` because
  they depend on per-request identity headers.

Dispatch owns `/signin-with-chatgpt`, `/signout-with-chatgpt`, `/callback`, the
OAuth cookies, and identity header injection. Do not implement app routes for
those reserved paths. Routes that do not import and call the helper remain
anonymous-compatible.

SIWC establishes identity only; it does not prove workspace membership. Use the
Sites hosting platform's access policy controls for workspace-wide restrictions,
or enforce explicit server-side membership or allowlist checks.

Use SIWC for account pages, user-specific dashboards, saved records, and write
actions tied to the current ChatGPT user. Leave public content anonymous.

## Useful Commands

- `npm run dev`: start local development
- `npm run build`: verify the vinext build output
- `npm run db:generate`: generate Drizzle migrations after schema changes

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)
