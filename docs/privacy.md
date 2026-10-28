# Privacy model

- **Web app:** SQL typed, pasted or uploaded is processed in the browser tab by the bundled engine. It is never transmitted. There is no backend, account, analytics or telemetry. The only third-party request is for IBM Plex fonts from Google Fonts (your IP address and user agent are visible to Google; no SQL is included).
- **CLI:** reads local `.sql` files and writes reports to stdout or a file. No network access.
- **GitHub Action:** runs on your runner; downloads pinned npm packages to build the CLI; requests no secrets; no database connection.
- SQL is never executed or modified by any component.
- Do not paste credentials into issues or the analyzer; the tool never asks for them.
