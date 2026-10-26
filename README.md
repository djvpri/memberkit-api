# MemberKit API

Backend kecil untuk app [MemberKit](https://github.com/djvpri/memberkit): backup data member + penampung log error/crash.

Node 20 + Postgres. Tanpa framework — `http` bawaan, `pg` satu-satunya dependensi.

## Endpoint

| Method | Path | Keterangan |
|---|---|---|
| GET | `/health` | status service + DB |
| POST | `/backup` | simpan snapshot member `{deviceId, appVersion, members:[]}` |
| GET | `/backup?deviceId=` | ambil snapshot terakhir |
| POST | `/logs` | kirim batch log `{deviceId, appVersion, logs:[{level,kind,tag,message,stack}]}` |
| GET | `/logs?limit=50&deviceId=` | baca log terbaru |

Auth: header `X-Device-Token: <DEVICE_TOKEN>`. `/health` bebas.

## Env

- `DATABASE_URL` — `postgres://user:pass@host:5432/db`
- `DEVICE_TOKEN` — token bersama, dipakai app
- `PORT` — default `3000`

## Tabel

Dibuat otomatis saat boot (`CREATE TABLE IF NOT EXISTS`): `mk_backup`, `mk_log`.

## Jalan lokal

```bash
npm install
DATABASE_URL=postgres://postgres:pw@localhost:5432/postgres DEVICE_TOKEN=rahasia npm start
curl localhost:3000/health
```

## Deploy (Coolify VPS Zomet)

- App UUID: `jxkbl0txftlkfv1dqjtmwjdu`, environment `memberkit` di project `tqzvtl1ppnpwrbf6pzces0s5`
- URL: `https://jxkbl0txftlkfv1dqjtmwjdu.103.93.129.94.sslip.io` (Let's Encrypt, valid)
- DB: container `e006bspftf2mjdmpbisks2k9` (postgres:18-alpine), DB & user `postgres`
- Env app: `DATABASE_URL`, `DEVICE_TOKEN`, `PORT=3000`
- Redeploy: `curl -X POST -H "Authorization: Bearer <coolify-token>" "http://<host>:8000/api/v1/deploy?uuid=jxkbl0txftlkfv1dqjtmwjdu"`
- Tabel dibuat otomatis saat boot.
