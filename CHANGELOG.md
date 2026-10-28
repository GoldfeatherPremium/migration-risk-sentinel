# Changelog

All notable changes are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Optional consent-gated Claude Sonnet 5 finding explanations with editable statement previews, streaming, Stop, and durable access pauses. Deterministic analysis, CLI, and Action stay offline.
- Core analysis engine: PostgreSQL-aware lexer, statement splitter, statement classifier.
- Rules MIG000–MIG005, MIG010–MIG015, MIG020–MIG023, MIG030–MIG034.
- Configuration (rule severity/off, options, exclusions, failOn, baseline), inline and file suppressions.
- JSON, Markdown and SARIF 2.1.0 reporters.
- CLI `scan` / `rules` with documented exit codes.
- Composite GitHub Action with job summary and SARIF output.
- Web app: analyzer, playground, rules, documentation, about.
