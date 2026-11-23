# Licences: what is and is not cleared

Samara's own code is all rights reserved (see the README). Everything it uses from others is listed in
[THIRD-PARTY-NOTICES.md](../THIRD-PARTY-NOTICES.md). One piece is not cleared:

- **castLabs ECS and Widevine.** Samara's paid-video engine comes from castLabs and is signed through their EVS
  service under castLabs' terms. Whether Samara builds can be handed to other people has not been checked against
  those terms, so no builds are offered here. The code that fetches and signs the engine is in this repo for reading;
  running it needs your own castLabs EVS account.
