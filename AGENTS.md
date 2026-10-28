<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Project rules
- The analysis engine lives in `packages/core/src` and must stay free of React, browser and network dependencies; the web app (`src/`), CLI (`packages/cli`) and GitHub Action all import it directly so results are identical everywhere.
- Core uses `.js` extensions in relative imports so the same sources compile with `tsc` (NodeNext) for the CLI and with Vite for the web app.
- SQL classification goes through the lexer/parser token model, never regex over raw SQL, so comments and strings can't trigger rules.
- Every rule needs a positive and a negative test in `tests/rules.test.ts`; sample SQL shown in the web app is loaded from `tests/fixtures` so demos stay real.
- Root tsconfig relaxes `noUncheckedIndexedAccess`/`exactOptionalPropertyTypes`/`noPropertyAccessFromIndexSignature` because core is token-index heavy and shared with the CLI build config.
- Optional AI belongs only in the web layer and uses a native Claude streaming server route; the deterministic core, CLI, and Action remain offline and identical.
- Findings use an immutable analyzed-source snapshot for excerpts and AI selection so later editor changes cannot silently alter the reviewed context.
- AI sends only explicitly consented statement SQL and trusted rule metadata; durable server-only access pauses store safe failure messages, never SQL or prompts.
