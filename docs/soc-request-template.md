# SOC request template

Paste the ticket body below when you open a request with Spring Oaks Capital
(SOC). Fill the angle-bracket fields, delete every line that does not apply to
this person, and send it on the approved SOC channel.

The body is the list SOC needs in one ticket: identity, the remote workspace,
GitHub, Cursor, Asana, and AWS. Splitting these across follow-up tickets is
what left recent people signed in but still blocked.

## Before you send

Collect only non-secret facts:

- Legal name, Prism email, personal email if the SOC mailbox does not exist yet
- GitHub username (the account that should be invited)
- Role and the work they will do (read, open pull requests, deploy DEV, read PROD)
- Whether they need a SOC laptop, and the shipping address if they do
- The repositories they will actually open

Leave passwords, MFA codes, access keys, personal access tokens, session
tokens, and API key values out of the ticket. Ask SOC where to pick those up.
Do not ask anyone to paste a secret back into chat or into the ticket.

## Ticket body

```text
Subject: SOC access for <full name> — <role>

Please set up the access below for one person. Reply on this ticket when each
checked item is done, and name anything you will not grant.

Person
- Name: <full name>
- Prism email: <name@prismteam.ai>
- Personal email (until the SOC mailbox exists): <email>
- GitHub username: <github-handle>
- Role: <role / team>
- Start: <date>
- Work they need access for: <one sentence, for example "open pull requests on Persist and read DEV">

1. SOC identity
- Create a @springoakscapital.com mailbox.
- Create the Microsoft Entra account, and let them finish MFA themselves.
- Make sign-in succeed for Office (https://office.com), Outlook, and Teams.
  An unregistered device has been blocked by Conditional Access (error 53003)
  even after the password was correct. That same block also stops NordLayer.
  Either enroll this person's device or give them a path that is already allowed.
- Grant NordLayer once Entra sign-in works.

2. Remote workspace
- Assign the Windows App / Azure Virtual Desktop desktops for this role.
  Engineering onboarding has used remote-workspace01 and techpool. Confirm
  those or name the correct pool.
- Confirm the session gets past "Connecting to workspace". A hang there has
  meant the VM was not assigned.

3. Laptop
- Ship a SOC-managed laptop to: <address, or "not needed">
- This is required when their own device cannot pass Conditional Access.

4. GitHub — org Spring-Oaks-Capital-LLC
- Invite GitHub user <github-handle> to the org as a member. Do not grant org owner.
- Read on soc-team-kit (the Chansey onboarding agent lives here).
- Write on the repositories they will change:
  <repo>
  <repo>
- Read on shared repos they need but will not change:
  - github-workflows (callers use ci-cd-dev.yml and ci-cd-prod.yml; keep those
    workflows accessible to repositories in the org)
  - lexicon
  - main-dashboard
- Add any other repo from the engineering list only if this person will open it:
  persist, sms-workflow, email-workflow, m2d-pipeline, so_banyan,
  templates-inventory, jigglypuff-agent, hoothoot-agent, filter.

5. Cursor
- Add this person to the SOC Cursor team tied to the Spring-Oaks-Capital-LLC
  GitHub org, so the editor and cloud agents can open those repositories.

6. Asana
- Invite <soc-mailbox> to the SOC Asana workspace.
- Add them to: <project names, or "the projects for their team">

7. AWS — only if this person will inspect or deploy
- IAM Identity Center / SSO only. Do not create long-lived access keys.
- Region us-east-2.
- DEV account 951132547414: <read, or deploy>
- PROD account 014948052063: <no access, or read-only>
- Production deploy stays off this request. A later ticket names the approver
  before any PROD permission set is granted.
- Permission set name, if SOC already has one for this role: <name or "SOC to choose">

8. Shared application access — only if this person will call a deployed API
- Tell them where to pick up the shared key for <environment>. Do not put the
  key, or any other secret, in this ticket.
- Shared domain, if one is already issued: <PRISM_DOMAIN or "SOC to confirm">

Please reply with the SOC email address, the GitHub invitation status, the
desktop pool assigned, and whether the laptop has shipped.
```

## After SOC replies

The person confirms each granted item themselves:

1. Sign in at https://office.com and open Teams with the SOC mailbox.
2. Connect NordLayer with that same Entra account.
3. Open the Windows App and reach the assigned desktop without stopping on
   "Connecting to workspace".
4. Accept the GitHub org invite and open
   `https://github.com/Spring-Oaks-Capital-LLC/soc-team-kit`.
5. Sign in to Cursor with the SOC team and open one granted repository.
6. Sign in to the SOC Asana workspace with the SOC mailbox.
7. If AWS was requested, `aws sts get-caller-identity` with the selected
   profile returns account `951132547414` for DEV or `014948052063` for PROD,
   in `us-east-2`.

Stop and reply on the same ticket if any step fails. A second ticket loses the
context SOC already has.
