# Referral Abuse Signal Salt

`REFERRAL_ABUSE_SIGNAL_SALT` is a server-only private secret used to correlate
referral abuse-signal hashes without storing raw IP addresses or user agents.

Live and production multiplayer servers must set a long, random value:

```text
REFERRAL_ABUSE_SIGNAL_SALT=<long-random-server-only-secret>
```

The value must:

- remain private and server-only;
- stay stable across multiplayer server restarts;
- never be committed to the repository;
- never be pasted into chat, Codex, GitHub, issues, or screenshots.

Changing the value prevents new abuse-signal hashes from correlating with hashes
created using the previous value. When the variable is missing, the server uses
a random process-local fallback. That fallback is acceptable for local
development only because correlation is lost when the process restarts.

## Release checklist

Before live referral testing or release:

- set `REFERRAL_ABUSE_SIGNAL_SALT` in the multiplayer server environment;
- restart the multiplayer server;
- confirm the server starts without the missing-salt warning and without
  exposing the configured value;
- confirm local `.env` and private secret files are not staged or committed.
