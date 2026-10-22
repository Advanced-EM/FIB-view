# FIB-view session collector: Cloudflare Worker

A free, always-on alternative to the Docker Space (`../space`), which needs a paid Hugging Face plan. It
receives the sessions visitors chose to share. It then:
- validates them with the same rules as `../space/schema.py`
- commits each one to the dataset as `raw/<scenario>/<session id>.json` through the Hub commit API

The Hugging Face token is a Cloudflare secret and never reaches the browser.

## Deploy (once)

```bash
cd hf/worker
npm install
npx wrangler login
npx wrangler secret put HF_TOKEN
npx wrangler deploy
```

- `npx wrangler login` opens the browser for a free Cloudflare account.
- At the `secret put` prompt, paste a fine-grained token with write access to the dataset only.
- `deploy` prints the URL, e.g. `https://fib-view-collector.<your-subdomain>.workers.dev`.

Open that URL. It should show `"dry_run": false`. Then set `url: '<that URL>/submit'` in `js/config.js`, run
`node tools/stamp.mjs`, and deploy the exhibit.

`wrangler.toml` holds `DATASET_REPO` and `ALLOWED_ORIGINS` (the exhibit's site and localhost for testing). It
also holds a rate limit of 10 sessions per minute per visitor, keyed on a daily salted hash, and nothing is
stored. The free plan allows 100,000 requests per day.

## News mailing list

The exhibit's "Subscribe for news" form posts the visitor's email to `/subscribe`. The address is stored in a
Cloudflare KV namespace that only your Cloudflare account can read. It never goes to the public dataset.

Set it up once:

```bash
npx wrangler kv namespace create SUBSCRIBERS
```

Paste the `id` it prints into `wrangler.toml` (replacing `PASTE_THE_ID_HERE`), then run `npx wrangler deploy`.
The status page (`/`) then shows `"mailing_list": true`.

Each subscriber gives a name, an email, an optional institution, and a role: student, staff, faculty or
hobbyist. To export the list as a spreadsheet:

```bash
node export-subscribers.mjs > subscribers.csv
```

The CSV holds personal data, so keep it private (`subscribers*.csv` is git-ignored). Each record is stored under
the key `email:<address>`. To remove someone, run
`npx wrangler kv key delete --binding SUBSCRIBERS --remote "email:<address>"`.

## Test

```bash
node test.mjs
```

This runs offline, with the Hub mocked. `npx wrangler dev` runs the Worker locally on port 8787.
