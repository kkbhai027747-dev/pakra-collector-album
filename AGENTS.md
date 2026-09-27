# Repository boundaries

This repository owns the unreleased collector-album service, synthetic preview and theme module. Start with README.md, API.md and HANDOFF.md. It is not a complete theme or the deployed V9 website.

- Use Node.js 24.19+. Safe checks: node --test test/server.test.mjs test/handoff.test.mjs and node build-catalog.mjs --check. Tests use synthetic identities and loopback only; no external dependency installation is needed.
- Keep fixtures/catalog-source/ and its pinned bytes. Preserve catalog identities, ownership rules, API shape and account isolation unless the task explicitly changes them.
- Keep theme/locales/*.json as partial additions. Merge only p10_album.ui into a separately approved target; never replace a complete locale file with these subsets.
- No deployment, application installation, real account connection, customer/order/payment lookup or scope expansion is implied by repository development. Keep real databases, runtime secrets, cookies and logs out of Git and terminal output; never put credentials in ordinary .env files.
- Any Shopify theme write must use the official Theme CLI, confirm the precise existing Theme ID and role, and include only explicitly approved paths. Default targets are unpublished/development; direct live/main writes are prohibited. Do not create or clone a theme to bypass this boundary. Publishing is allowed only after the user explicitly says “允许发布主主题” or “发布到线上” in the current task, followed by reconfirming the exact Theme ID and role.
- Use only an approved official runtime credential mechanism for any future integration. Synthetic preview identities and generated temporary signing material are for local tests only.
- SOURCE-MANIFEST.json records historical provenance. The current build reads only the fixtures named in catalog-sources.json, not an adjacent repository.
