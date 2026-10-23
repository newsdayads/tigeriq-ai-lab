# TigerIQ Game — G04 technical preview

Work Order: https://github.com/newsdayads/tigeriq-ai-lab/issues/5183. Depends on accepted G01 (#5180).

This is an isolated, buildable Web 2D technical preview, not the five-level game, production release, or legal clearance. It demonstrates Canvas 2D rendering and touch-friendly direction/reset controls. G02 defines the puzzles; G05 develops the engine/solver; G06 integrates the game.

## Commands

Node 22.14+; no npm dependencies, install, credential, CDN or network required.

- npm run lint
- npm run build
- npm test
- npm run verify

To see it locally after build: python3 -m http.server 8000 -d dist, then open http://127.0.0.1:8000.

## ADR-0001: dependency-free Web 2D shell

For G04, choose TypeScript source + Node 22 built-in stripTypeScriptTypes and native Canvas 2D as a scoped alternative to the original Phaser/Vite preference. This makes the foundation runnable without adding packages or licenses. Phaser MIT (https://phaser.io/download/license) remains an allowable candidate for later work if its exact versions and license notices are validated; Phaser Editor is not included.

**Limitations:** built-in stripping does not perform TypeScript typechecking; the custom lint validates syntax, whitespace, accessibility attributes and restricted source operations, not full ESLint. Local tsc --noEmit with tsconfig.json may be used when TypeScript is available. Unit tests cover preview state and emitted artifacts, not real-browser/phone QA, five levels or the solver.

**Safety:** no paid services, secrets, cookies, network calls, cross-app imports, PII or borrowed art/audio. Assets are drawn procedurally and system fonts are used. The app is not published to Production.
