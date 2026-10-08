# Publishing to the Chrome Web Store

Store item: `kdlfdajncknkinjdhfmgiggdpgblejih`, publisher `0b5a1a74-3ebd-4855-b6ec-7b8798461012`.

## Releasing

1. Bump `version` and `version_name` in `manifest.json` (`2026.10.5.3` / `2026.10.05.03`;
   Chrome versions have no leading zeros) and commit to `main`.
2. `git tag v2026.10.5.3 && git push origin v2026.10.5.3`

The Build workflow then runs the tests, checks the tag matches the manifest, makes a GitHub
release with the zip, uploads the zip to the store, and submits it for review. Google publishes
it once approved (hours to a few days). Listing text, images, and privacy answers are edited in
the dashboard only; the API can't change them (texts are in `LISTING.md`).

## Current setup (done Oct 2026)

- Google Cloud project `refrunner-495617` (refrunner), owned by jay@literatecomputing.com.
- Service account `cws-publisher@refrunner-495617.iam.gserviceaccount.com`, added in the
  dashboard's Settings as the publisher's service account.
- Workload identity pool/provider `github` (only `literatecomputing/refrunner-toolkit`).
- Repo variables `GCP_WIF_PROVIDER` and `GCP_SERVICE_ACCOUNT`.
- **What's live and what's in review:** `npm run store-status` (prints `Live:` and `In review:`).
  Same as Actions → **Store status** → Run workflow. Google doesn't email when a version is
  approved, so this is how to tell.

## One-time setup: let GitHub Actions publish

No key file: GitHub's OIDC token is exchanged for a short-lived Google token for a service
account (Workload Identity Federation). Run once, with `gcloud` signed in to the Google account
that should own the project (`gcloud auth login`):

```bash
PROJECT=refrunner-toolkit-ci            # or an existing project id
REPO=literatecomputing/refrunner-toolkit

gcloud projects create $PROJECT          # skip if using an existing project
gcloud services enable chromewebstore.googleapis.com iamcredentials.googleapis.com \
  sts.googleapis.com --project $PROJECT
gcloud iam service-accounts create cws-publisher --project $PROJECT \
  --display-name "Chrome Web Store publisher (GitHub Actions)"
gcloud iam workload-identity-pools create github --project $PROJECT --location global
gcloud iam workload-identity-pools providers create-oidc github --project $PROJECT \
  --location global --workload-identity-pool github \
  --issuer-uri https://token.actions.githubusercontent.com \
  --attribute-mapping google.subject=assertion.sub,attribute.repository=assertion.repository \
  --attribute-condition "assertion.repository=='$REPO'"
NUMBER=$(gcloud projects describe $PROJECT --format 'value(projectNumber)')
gcloud iam service-accounts add-iam-policy-binding \
  cws-publisher@$PROJECT.iam.gserviceaccount.com --project $PROJECT \
  --role roles/iam.workloadIdentityUser \
  --member "principalSet://iam.googleapis.com/projects/$NUMBER/locations/global/workloadIdentityPools/github/attribute.repository/$REPO"

gh variable set GCP_WIF_PROVIDER -R $REPO \
  --body "projects/$NUMBER/locations/global/workloadIdentityPools/github/providers/github"
gh variable set GCP_SERVICE_ACCOUNT -R $REPO --body "cws-publisher@$PROJECT.iam.gserviceaccount.com"
```

Then, in the Chrome Web Store Developer Dashboard → **Account**, add
`cws-publisher@<PROJECT>.iam.gserviceaccount.com` as the service account (one per publisher).

Only workflows in this repository can use the service account (the attribute condition), and it
can do nothing but what the dashboard grants it.

The first submission is done by hand in the dashboard (Google requires visibility and the
listing to be set there once); the workflow handles every release after that.
