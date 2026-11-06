# ClearPoint Global CRM

Recruiting CRM for the ClearPoint Global team. Frank (fadybashir3218@gmail.com) is always the owner.

- `web/` – the CRM screens (published to GitHub Pages; every change reaches every installed app the next time it opens)
- `desktop/` – the Mac/Windows program (Electron) that opens the screens in its own window
- `supabase/schema.sql` – database, logins, roles (owner, manager, recruiter) and row-level security
- `.github/workflows/` – builds the installers (`release.yml`, on tags `v*`) and publishes the screens (`pages.yml`)

## Roles
- **Owner**: sees and edits everything, invites anyone, sets roles, edits team scripts, deletes agents.
- **Manager**: sees their recruiters' agents and the unassigned pool, imports and assigns agents, invites recruiters to their team.
- **Recruiter**: sees only agents assigned to them; emails, texts, calls and logs replies.

## Setup (one time)
1. Supabase: create project, run `supabase/schema.sql` in SQL Editor, copy Project URL + anon key into `web/config.js`.
   In Authentication → URL Configuration set Site URL to the GitHub Pages address.
2. GitHub: public repo `clearpoint-crm`; Settings → Pages → Source: GitHub Actions.
3. Replace `frank7788dev` in `desktop/package.json`, push, then push a tag `v1.0.0` to build installers.
4. Share `https://frank7788dev.github.io/clearpoint-crm/download.html` with the team.
