# Deploying PartsWagen

Written so you can ship without asking anyone. Three steps: push, wait for the
build, run the playbook.

## What runs where

| Thing | Where |
| --- | --- |
| The app | LXC `partswagen`, `192.168.1.184` |
| Public URL | <https://parts.biggaydiesel.com> (Traefik on `192.168.1.77` routes to it) |
| Photos | <https://parts-s3.biggaydiesel.com> → MinIO on the same LXC |
| Compose files | `/root/partswagen/` on that LXC |
| Data | `/data/partswagen/{postgres,minio}` |
| Ansible | LXC `ansible.biggaydiesel.com`, checkout at `/root/ansible` |

You never build images yourself. GitHub Actions builds them on every push to
`main` and publishes them to GHCR; the playbook pulls whatever is newest.

## 1. Push

```bash
git push
```

Pushing to `main` starts three workflows: **CI** (tests, linting, migrations),
**Security**, and **Publish images**.

## 2. Wait for all three to go green

At <https://github.com/iff7378/partswagendb/actions>, or from the terminal:

```bash
curl -s "https://api.github.com/repos/iff7378/partswagendb/actions/runs?head_sha=$(git rev-parse HEAD)" \
  | python3 -c "import sys,json
for r in json.load(sys.stdin)['workflow_runs']:
    print(f\"{r['name']:20} {r['status']:12} {r['conclusion'] or '-'}\")"
```

**Publish images is the one that matters for deploying** — it is what puts the
new image on GHCR. CI passing while Publish images is still running means there
is nothing new to deploy yet. It takes a few minutes because it builds for both
amd64 and arm64.

If CI fails, read the log on GitHub and fix it before going further. Everything
CI runs, you can run locally with `make check`.

## 3. Deploy

```bash
ssh root@ansible.biggaydiesel.com
cd /root/ansible
git pull
ansible-playbook playbooks/partswagen.yml
```

Log in as **`root`**, not `ansible` — the `ansible` user does not accept the key.

Expect `changed=3` on a normal deploy: the image pull, the compose up, and the
container restart. `changed=0` means there was nothing new to pull, which
usually means Publish images had not finished when you ran it.

Add `--check --diff` for a dry run that changes nothing.

### Migrations

You do not run these. The backend container applies them on start, before it
serves anything. The playbook waits for the API to answer before it calls the
deploy done, so if a migration fails the playbook fails with it.

## Checking it worked

```bash
curl -s https://parts.biggaydiesel.com/api/health
```

The version it reports is the CalVer stamp of the running image
(`2026.09.01-6` style — the date plus a counter for that day's releases). The
same string is at the bottom of every page in the app, so you can confirm from
your phone.

To see the migrations that ran:

```bash
ssh root@192.168.1.184 'docker logs partswagen-backend 2>&1 | grep -i alembic | tail'
```

## Backups

A nightly timer dumps the database to `/data/partswagen/dumps` and keeps the
recent ones. Before a deploy that changes the database shape, take one by hand:

```bash
ssh root@192.168.1.184 'systemctl start partswagen-dump.service'
ssh root@192.168.1.184 'ls -lh /data/partswagen/dumps | tail -3'
```

Proxmox also backs up the whole container.

## If something goes wrong

**The app is down after a deploy.** Look at the container:

```bash
ssh root@192.168.1.184 'docker ps -a && docker logs --tail 50 partswagen-backend'
```

**Roll back to the previous image.** Images are tagged with their version, so
pin the old one in `/root/partswagen/docker-compose.yml` (change `:latest` to
e.g. `:2026.09.01-5` on both services) and `docker compose up -d`. Then fix
forward and put `:latest` back.

**A migration failed.** The container will be restarting in a loop and the
database is untouched, because migrations run in a transaction. Roll back to
the previous image as above, then fix the migration.

**Traefik serves a 404.** It watches `/root/traefik/dynamic.yml` by inode, and
Ansible writes a new file rather than editing in place, so it can end up
watching the old one. The traefik role restarts it on change; if you edited by
hand, `docker restart traefik`.

**Ansible looks like it has hung.** Over a non-interactive SSH session it is
output buffering, not Ansible. Run it so it writes to a file instead:

```bash
ssh root@ansible.biggaydiesel.com \
  'cd /root/ansible && nohup ansible-playbook playbooks/partswagen.yml > /tmp/deploy.log 2>&1 </dev/null &'
ssh root@ansible.biggaydiesel.com 'tail -30 /tmp/deploy.log'
```

## Things not to do

- **Do not edit files on the Ansible box.** It is a clean checkout; changes
  belong in `~/Code/homelab`, pushed, then pulled down.
- **Do not regenerate `secrets.env`** on the app host. It holds the database
  password and the MinIO keys; rewriting it orphans the existing database and
  photo bucket. The role generates it once and never touches it again.
- **Do not deploy straight from a feature branch.** Only `main` publishes
  images.
