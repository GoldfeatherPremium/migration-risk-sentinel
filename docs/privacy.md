# Privacy model

- **Web app:** SQL typed, pasted or uploaded is processed in the browser tab by the bundled engine. Normal analysis never transmits SQL. Optional Claude explanations send only the editable statement preview and rule details after explicit consent, through Lovable Cloud to Claude Sonnet 5. Anthropic may retain submissions under its provider policy; gateway processing/logging policies also apply. No other files are shared. SQL and explanations are not stored by app code. The backend stores only a safe AI access-pause message after access failures, never SQL or prompts. There are no app accounts or analysis telemetry. The app also requests IBM Plex fonts from Google Fonts (your IP address and user agent are visible to Google; no SQL is included).
- **CLI:** reads local `.sql` files and writes reports to stdout or a file. No network access.
- **GitHub Action:** runs on your runner; downloads pinned npm packages to build the CLI; requests no secrets; no database connection.
- SQL is never executed or modified by any component.
- Do not paste credentials into issues or the analyzer; the tool never asks for them.
