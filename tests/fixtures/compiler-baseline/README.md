# Desktop compiler reference fixtures

Captured on 2026-09-12 by `scripts/capture-compiler-baseline.cjs` from the installed Pika 1.13.4 desktop addon. `report.json` records addon, generator, source and bytecode SHA256 hashes. Each fixture was independently compiled twice with identical output.

23 card defaults plus 6 structural/boundary programs. `.json` is our block program, `.py` is generated source, `.py.o` is the complete desktop reference bytecode. Treat these files as expected results: native compiler tests must not rewrite them. Regeneration requires the original desktop addon and explicit review of output differences.
