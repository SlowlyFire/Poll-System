# Deploying to Railway

One service, one process. Express serves the API **and** the built React client from the
same port, so there is no second deployment, no CORS config, and no `VITE_API_URL` to keep
in sync between environments.

## What railway.json does, line by line

| Setting | Why |
|---|---|
| `buildCommand: npm install --include=dev && npm run build` | `--include=dev` is **not** optional. `vite` and `typescript` are devDependencies and the build needs them; Railway may set `NODE_ENV=production`, which makes npm skip dev dependencies, and the build then fails with `vite: not found`. |
| `startCommand: npm start` | Runs the compiled server (`node dist/index.js`). No `tsx` in production — TypeScript is compiled ahead of time by `npm run build`. |
| `healthcheckPath: /api/health` | Railway waits for a 200 here before routing traffic to a new deployment, so a broken build never replaces a working one. |
| `restartPolicyType: ON_FAILURE` | Restart on a crash, but don't loop forever on a deployment that can never start. |

## Environment variables to set in Railway

| Variable | Value | Note |
|---|---|---|
| `DB_PATH` | `/data/poll.db` | Must be inside the mounted volume. |
| `PORT` | *(do not set)* | Railway injects it. Hard-coding it breaks routing. |

## The volume, and why it is the whole ballgame

A container's filesystem is **ephemeral**: it is rebuilt from the image on every deploy and
every restart. SQLite is a file on that filesystem. So without a volume, every redeploy
silently wipes all the polls and votes — the app keeps working, the data is just gone.

Attaching a Railway volume mounted at `/data` and pointing `DB_PATH` at it gives that one
file a home that survives deploys.

**The honest limit:** a volume attaches to exactly one instance. This service cannot be
scaled to two replicas, because two containers cannot share one SQLite file safely — they
would each hold their own copy and diverge. Vertical scaling (a bigger container) works;
horizontal does not.

**What migrating to Postgres would actually involve:** swap `better-sqlite3` for `pg`,
make every query `await` (the driver is async, so the route handlers become async — and at
that point Express 4 no longer catches thrown errors automatically, so `app.ts` needs an
async wrapper or `next(err)` by hand). The SQL itself barely changes: `TEXT`/`INTEGER`
become `text`/`serial`, and `UNIQUE(poll_id, username)` is identical in Postgres. The
schema design does not change at all — which is the point of having designed it properly.

## Gotcha: pin the Node version, or the build fails on a native module

`better-sqlite3` is a **native** module — C++ that has to be compiled for the exact
platform *and* Node version. To avoid compiling on every install, it ships **prebuilt
binaries** and `prebuild-install` downloads the matching one.

Our first Railway build failed like this:

```
prebuild-install warn install No prebuilt binaries found
    (target=24.10.0 runtime=node arch=x64 libc= platform=linux)
gyp ERR! find Python  Could not find any Python installation to use
```

Read it in order, because the second error is a symptom, not the cause:

1. `engines.node` said `>=22`, so Railway installed the newest it had — **Node 24**.
2. better-sqlite3 11.7 publishes no prebuilt binary for Node 24, so `prebuild-install` found nothing.
3. It fell back to `node-gyp`, which compiles from source.
4. Compiling needs Python, and the build image has none. Build dead.

**Fix: pin the version instead of setting a floor** — `"node": "22.x"` in `engines`, plus a
`.nvmrc`. Node 22 has a published prebuild, so nothing is ever compiled.

`>=22` looks safer than `22.x` and is the opposite: a floor invites the host to hand you a
Node version nobody has tested this dependency against. The two real alternatives were
upgrading better-sqlite3 to a release with Node 24 prebuilds, or adding Python and a
toolchain to the build image so compiling actually works — both more moving parts than
matching the version we already tested on.
