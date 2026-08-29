# Shivani Gems Custom Projects — V1

Single-customer custom jewelry collaboration portal built for Cloudflare Pages + Pages Functions + D1 + R2.

## What is included

### Admin
- Create projects with name, project type, client/PO reference, requested delivery date, metal, size/dimensions, full brief, supplied stones/materials, internal notes, and multiple reference images.
- Add multiple design proposals inside each project.
- Each proposal supports multiple images, free-text metal, finished-piece price, customer-facing notes, and unlimited diamond lines.
- Diamond lines support Shape, Weight, whether weight is total or per-stone, # Stones, Color/Clarity, Measurements.
- Manual status control across: Project Received → Designs Generated → Designs In Review → Project Approved → In Production → Shivani Gems QC → Shipped → Delivered. The only automatic status change is customer approval → Project Approved.
- See and respond to customer comments on every proposal.
- Leave proposal pricing blank while a quote is pending, flag prices that include Shivani-provided diamonds, and copy diamond lines from another proposal in the same project.
- Record each diamond line as Natural, Lab Grown, or unspecified.
- Permanently delete a project and its associated proposals, comments, database file records, and private R2 uploads.

### Customer
- Dashboard of project cards with project name, creation date, proposal count, requested delivery date, and current status.
- Full project page with a progress tracker and collapsible reference-image gallery.
- Proposal cards with thumbnail, quoted price, total carat weight, metal and comment count.
- Full proposal details with image gallery and complete diamond breakdown.
- Threaded project-design comments for edit requests/questions.
- Approve a proposal. Approval automatically moves that proposal first, sets project status to Project Approved, and visually collapses the non-approved proposals.

## Architecture
- `public/` — static frontend (plain HTML/CSS/JS; no framework/build tool)
- `functions/api/[[path]].js` — Cloudflare Pages Functions API
- D1 binding: `DB`
- R2 binding: `UPLOADS`
- Secret: `BOOTSTRAP_USERS_JSON`
- No `package-lock.json` and no package dependencies are required.

## GitHub setup

1. Create a new empty GitHub repository, for example `shivani-custom-projects-v1`.
2. From this folder run:

```bash
git init
git add .
git commit -m "Initial custom projects portal"
git branch -M main
git remote add origin https://github.com/YOUR_GITHUB_USERNAME/shivani-custom-projects-v1.git
git push -u origin main
```

## Cloudflare setup

### 1. Create the D1 database
In Cloudflare Dashboard:
- Workers & Pages → D1 SQL Database → Create database
- Suggested name: `shivani-custom-projects`

You do **not** have to manually run `schema.sql`; the API creates its tables automatically. The file is there for reference/manual use.

### 2. Create the R2 bucket
- R2 Object Storage → Create bucket
- Suggested name: `shivani-custom-project-uploads`

This stores project reference images and design/proposal images.

### 3. Create the Pages project from GitHub
- Workers & Pages → Create application → Pages → Import an existing Git repository
- Pick the GitHub repo
- Production branch: `main`
- Framework preset: None
- Build command: `exit 0`
- Build output directory: `public`
- Root directory: leave blank

Important: `/functions` stays at the repository root. Do not move it into `/public`.

### 4. Add the D1 binding
On the Pages project:
- Settings → Bindings → Add → D1 database
- Variable name: `DB`
- Select the D1 database created above

### 5. Add the R2 binding
- Settings → Bindings → Add → R2 bucket
- Variable name: `UPLOADS`
- Select the R2 bucket created above

### 6. Add the login bootstrap secret
- Settings → Variables and Secrets → Add
- Name: `BOOTSTRAP_USERS_JSON`
- Choose **Encrypt**
- Value should be the following JSON, using the three usernames/passcodes you specified for this V1:

```json
[
  {"username":"Saunak","displayName":"Saunak","role":"admin","passcode":"<SAUNAK PASSCODE>"},
  {"username":"Atit","displayName":"Atit","role":"admin","passcode":"<ATIT PASSCODE>"},
  {"username":"Doug","displayName":"Doug","role":"customer","passcode":"<DOUG PASSCODE>"}
]
```

Paste the array itself as the value. Do not paste the variable name after the closing `]`, and use real line breaks (or keep the JSON on one line) rather than typing literal `\\n` sequences. The API also normalizes those two common copy/paste mistakes, but clean JSON is recommended.

Use the exact passcodes from your project brief when entering this secret in Cloudflare. They are intentionally not committed into GitHub.

### 7. Redeploy
Bindings/secrets are applied to a deployment. After adding them, go to Deployments and redeploy the latest commit (or push another commit).

The first API request will:
1. Create all D1 tables if they do not exist.
2. Detect that there are no users.
3. Read `BOOTSTRAP_USERS_JSON`.
4. PBKDF2-hash each passcode with a unique salt and store only the hash in D1.

After that, the bootstrap secret is no longer needed for normal logins, though leaving it configured is fine because bootstrapping runs only when the user table is empty.

If login reports a server error, the message shown beneath the form includes the underlying setup problem. The most common causes are a missing D1 binding named exactly `DB`, configuring the binding or secret for Preview instead of Production, or not redeploying after changing the environment configuration. Do not hard-code usernames or passcodes into `public/` files: those files are delivered to every visitor.

## Local development (optional)

No npm install is required. Wrangler can be run through `npx` if you want local testing.

Create `.dev.vars` (it is gitignored):

```dotenv
BOOTSTRAP_USERS_JSON='[{"username":"Saunak","displayName":"Saunak","role":"admin","passcode":"YOUR_PASSCODE"},{"username":"Atit","displayName":"Atit","role":"admin","passcode":"YOUR_PASSCODE"},{"username":"Doug","displayName":"Doug","role":"customer","passcode":"YOUR_PASSCODE"}]'
```

Then use Wrangler Pages dev with local D1/R2 bindings. For production deployment through GitHub, the Cloudflare dashboard bindings above are the important part.

## Upload behavior
- File inputs allow multiple images.
- Backend storage does not depend on the filename extension casing, so `.png`, `.PNG`, `.jpg`, `.JPG`, `.jpeg`, `.JPEG`, `.webp`, `.WEBP`, etc. are fine.
- R2 keeps the original filename/content type metadata.
- Browser-renderable raster image types are served inline; other uploaded types are served as downloads for safety.

## Security notes
- Passcodes are never in `public/app.js` or any client-side file.
- Login sessions use random server-side tokens stored in D1 and `HttpOnly; Secure; SameSite=Lax` cookies.
- Stored passcodes use PBKDF2-SHA256 with per-user random salts.
- R2 is accessed through authenticated Pages Functions rather than a public bucket URL.
- Internal project notes are stripped from the customer API response.

## V1 intentionally not included yet
- Gmail-specific notification integration (notifications use HubSpot instead)
- Multiple customer organizations/accounts
- Password reset flow
- Fine-grained audit history / notification center
- Proposal editing/deletion UI
- Production invoice/payment handling

Those are good V2 additions once the single-customer workflow is validated.

## HubSpot notifications

The API submits portal events to the HubSpot form for portal `45715522`, form `3799d2a4-7876-4b70-9c14-054dcff947c2`, using `doug@uniqjewelry.com` as the enrolled contact. The supported event types are `design_created`, `comment_created`, `design_approved`, and `status_updated`. HubSpot workflows remain responsible for branching and sending customer or internal emails.

The defaults can be changed without a code edit by adding any of these Cloudflare environment variables and redeploying:

```dotenv
HUBSPOT_PORTAL_ID=45715522
HUBSPOT_FORM_ID=3799d2a4-7876-4b70-9c14-054dcff947c2
HUBSPOT_CUSTOMER_EMAIL=doug@uniqjewelry.com
PORTAL_URL=https://shivanicustom.pages.dev
```

Notification delivery is best-effort: HubSpot failures are logged but do not undo a successfully saved comment, proposal, approval, or status update. The HubSpot form must contain fields matching the `portal_*` internal property names used by the API, and its workflow must allow re-enrollment for every submission.

When HubSpot rejects a submission, the portal shows the rejection beneath the successful action for ten seconds. This distinguishes delivery/configuration failures from workflow problems: if no warning appears, check the HubSpot form's submission history and workflow enrollment history; if a warning appears, its response text identifies the field or form setting HubSpot rejected.
