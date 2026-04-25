# Changelog

## [1.6.1](https://github.com/aletc1/kyomiru/compare/kyomiru-v1.6.0...kyomiru-v1.6.1) (2026-04-25)


### Bug Fixes

* **web:** mobile layout for show actions and library toolbar ([#49](https://github.com/aletc1/kyomiru/issues/49)) ([5652f2f](https://github.com/aletc1/kyomiru/commit/5652f2f00917a95fa9c323fa0389726634fa2d95))

## [1.6.0](https://github.com/aletc1/kyomiru/compare/kyomiru-v1.5.1...kyomiru-v1.6.0) (2026-04-25)


### Features

* **web:** add Open in JustWatch button on show views ([#47](https://github.com/aletc1/kyomiru/issues/47)) ([b9abf07](https://github.com/aletc1/kyomiru/commit/b9abf0775da60f879eb64c29a11282abf3c1b2df))

## [1.5.1](https://github.com/aletc1/kyomiru/compare/kyomiru-v1.5.0...kyomiru-v1.5.1) (2026-04-25)


### Bug Fixes

* **api:** harden enrichment/show-refresh workers and external-id writes ([#43](https://github.com/aletc1/kyomiru/issues/43)) ([4a3b168](https://github.com/aletc1/kyomiru/commit/4a3b16892c5ff682661b81c75a70f78573240f23))
* **api:** merge duplicate shows that map to the same tmdb/anilist id ([#45](https://github.com/aletc1/kyomiru/issues/45)) ([9bcbf50](https://github.com/aletc1/kyomiru/commit/9bcbf50ec4d70afa891e166fb879cb3e237777b1))

## [1.5.0](https://github.com/aletc1/kyomiru/compare/kyomiru-v1.4.3...kyomiru-v1.5.0) (2026-04-25)


### Features

* **api:** show-refresh worker, airing/debug scripts, sync chunk fix ([#40](https://github.com/aletc1/kyomiru/issues/40)) ([8a4daf2](https://github.com/aletc1/kyomiru/commit/8a4daf24c76d125c71133dee6aacf93d9f2e924e))
* **web:** auto-update PWA with reload toast and theme refresh ([#42](https://github.com/aletc1/kyomiru/issues/42)) ([e51eb36](https://github.com/aletc1/kyomiru/commit/e51eb36918344779b8a075ac7ff1cada32afff79))

## [1.4.3](https://github.com/aletc1/kyomiru/compare/kyomiru-v1.4.2...kyomiru-v1.4.3) (2026-04-25)


### Bug Fixes

* **api:** broaden show classifier to promote any Animation genre to anime ([#37](https://github.com/aletc1/kyomiru/issues/37)) ([575c4c2](https://github.com/aletc1/kyomiru/commit/575c4c248ee4530a41e6bbf1143ccda8369d4af6))
* **i18n:** update locale imports to .js and add translations for en-U… ([#35](https://github.com/aletc1/kyomiru/issues/35)) ([18b2e73](https://github.com/aletc1/kyomiru/commit/18b2e73cffddd19c766a33fd3cd758841b44948a))
* **web:** rename Anime label to Animation across all locales ([#39](https://github.com/aletc1/kyomiru/issues/39)) ([6d5e3a5](https://github.com/aletc1/kyomiru/commit/6d5e3a53529418d7b6d9435bdbf1e77fcd6ca693))


### Performance Improvements

* **sync:** bulk-SQL ingest, mid-sync JWT refresh, parallel catalog fetch ([#38](https://github.com/aletc1/kyomiru/issues/38)) ([d940144](https://github.com/aletc1/kyomiru/commit/d9401446de61aa6ff2dad94fdccc5b11f202a4c9))

## [1.4.2](https://github.com/aletc1/kyomiru/compare/kyomiru-v1.4.1...kyomiru-v1.4.2) (2026-04-24)


### Bug Fixes

* **infra:** decouple landing image from chart release and fix shared build ([#33](https://github.com/aletc1/kyomiru/issues/33)) ([ef67d7f](https://github.com/aletc1/kyomiru/commit/ef67d7f65c81fd9ce7cb0b5736aa358bd6c2f4ce))

## [1.4.1](https://github.com/aletc1/kyomiru/compare/kyomiru-v1.4.0...kyomiru-v1.4.1) (2026-04-24)


### Bug Fixes

* **infra:** include @kyomiru/shared in landing Dockerfile deps stage ([#31](https://github.com/aletc1/kyomiru/issues/31)) ([68effdc](https://github.com/aletc1/kyomiru/commit/68effdca38167e9bb1295168b88bf56fee446e32))

## [1.4.0](https://github.com/aletc1/kyomiru/compare/kyomiru-v1.3.0...kyomiru-v1.4.0) (2026-04-24)


### Features

* i18n (es-ES, fr-FR) across web, landing, and extension ([#28](https://github.com/aletc1/kyomiru/issues/28)) ([b2c1ee0](https://github.com/aletc1/kyomiru/commit/b2c1ee06e15c607d6bbdcdcabbcdcbfc7504f4e1))


### Bug Fixes

* **web:** hamburger button now opens sidebar drawer on mobile ([#29](https://github.com/aletc1/kyomiru/issues/29)) ([62510a9](https://github.com/aletc1/kyomiru/commit/62510a981eb536a55076b6c1458e0cc0562183ef))

## [1.3.0](https://github.com/aletc1/kyomiru/compare/kyomiru-v1.2.0...kyomiru-v1.3.0) (2026-04-24)


### Features

* **landing:** marketing site at apps/landing + quay.io image ([#25](https://github.com/aletc1/kyomiru/issues/25)) ([904bfcb](https://github.com/aletc1/kyomiru/commit/904bfcbcb99d91fef1071cbeeaf614fa8887bbe2))

## [1.2.0](https://github.com/aletc1/kyomiru/compare/kyomiru-v1.1.2...kyomiru-v1.2.0) (2026-04-24)


### Features

* invite-only signup gate (DISABLE_AUTO_SIGNUP) + logo refresh ([#22](https://github.com/aletc1/kyomiru/issues/22)) ([d36e28c](https://github.com/aletc1/kyomiru/commit/d36e28c68392e38b98bcedd04c7f703cd8ee3b45))
* multi-language metadata + anime reclassification + TMDB community rating ([#24](https://github.com/aletc1/kyomiru/issues/24)) ([247e95e](https://github.com/aletc1/kyomiru/commit/247e95e148b7b3821ba13b3d9c15ee6830b665e9))

## [1.1.2](https://github.com/aletc1/kyomiru/compare/kyomiru-v1.1.1...kyomiru-v1.1.2) (2026-04-24)


### Bug Fixes

* **web:** prevent service worker from intercepting /api navigations ([#20](https://github.com/aletc1/kyomiru/issues/20)) ([db5dc4c](https://github.com/aletc1/kyomiru/commit/db5dc4ca4ffb710eac4bcc7425221be893c5f4dc))

## [1.1.1](https://github.com/aletc1/kyomiru/compare/kyomiru-v1.1.0...kyomiru-v1.1.1) (2026-04-24)


### Bug Fixes

* **infra:** ci smoke test ([#19](https://github.com/aletc1/kyomiru/issues/19)) ([2819732](https://github.com/aletc1/kyomiru/commit/2819732d26a86ec9031dc125d00eb1fdb592cf76))
* **infra:** make api & web docker images runnable ([#17](https://github.com/aletc1/kyomiru/issues/17)) ([5db2c4e](https://github.com/aletc1/kyomiru/commit/5db2c4e225512c26bac3f7bcf06e60850bb0a532))

## [1.1.0](https://github.com/aletc1/kyomiru/compare/kyomiru-v1.0.0...kyomiru-v1.1.0) (2026-04-24)


### Features

* **infra:** add Helm chart for Kubernetes deployment ([#15](https://github.com/aletc1/kyomiru/issues/15)) ([2790858](https://github.com/aletc1/kyomiru/commit/2790858894444b4302e920ce7f7cb1a8d109990a))

## [1.0.0](https://github.com/aletc1/kyomiru/compare/kyomiru-v0.2.0...kyomiru-v1.0.0) (2026-04-24)


### ⚠ BREAKING CHANGES

* add Recently Watched sort, rename Updated Date to Latest Air Date ([#12](https://github.com/aletc1/kyomiru/issues/12))

### Features

* add Recently Watched sort, rename Updated Date to Latest Air Date ([#12](https://github.com/aletc1/kyomiru/issues/12)) ([391abe7](https://github.com/aletc1/kyomiru/commit/391abe7b35402924a0f65b7658f6e91f99eb14f7))
* **extension:** proactively refresh Crunchyroll session on navigation ([#11](https://github.com/aletc1/kyomiru/issues/11)) ([82e4272](https://github.com/aletc1/kyomiru/commit/82e4272eb412b6b92efde570947ac4c64dffe8cd))
* Netflix provider + multi-provider Chrome extension ([#6](https://github.com/aletc1/kyomiru/issues/6)) ([4ce8fac](https://github.com/aletc1/kyomiru/commit/4ce8fac993c9988f7ac6858272951206bb0eb52b))
* provider deep-link buttons on shows and episodes ([214f056](https://github.com/aletc1/kyomiru/commit/214f056f5a99519ecc994b75c3839945318747ba))
* release-please pipeline, Quay.io images, and self-host compose ([#8](https://github.com/aletc1/kyomiru/issues/8)) ([964b8ed](https://github.com/aletc1/kyomiru/commit/964b8edc55c05b1d2a3df30a6996742b7d7bda3c))
* show last watch date per episode in show detail ([#4](https://github.com/aletc1/kyomiru/issues/4)) ([ff6342e](https://github.com/aletc1/kyomiru/commit/ff6342e35f28d129de745e60f995125c0d2d2e7c))
* unify services + extension tokens UX, attribute syncs to devices ([#10](https://github.com/aletc1/kyomiru/issues/10)) ([6c0ea69](https://github.com/aletc1/kyomiru/commit/6c0ea696724b2c53dac92744a67b7c5fdbdf2dbb))
* update 7 files ([#7](https://github.com/aletc1/kyomiru/issues/7)) ([99164fc](https://github.com/aletc1/kyomiru/commit/99164fc0a1a4fd9588d90bc3ae8ef0867c8c019b))
