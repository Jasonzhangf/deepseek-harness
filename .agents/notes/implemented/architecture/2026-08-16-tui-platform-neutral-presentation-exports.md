# Agent Note: Platform-neutral presentation exports for TUI consumers

Status: implemented

English | [中文](2026-08-16-tui-platform-neutral-presentation-exports.zh.md)

## Problem

The external TUI consumer needs the DSH conversation, tool, workflow, trajectory, and Markdown projection owners without mounting the browser client object layer or importing private `src/*` paths. The existing package faces were browser-oriented and did not provide an installable, plain-Node entrypoint for these projection definitions.

## Decision

The owning client packages publish platform-neutral subpaths for the TUI composition:

- `@deepseek-ai/dsh-client-runtime/presentation`
- `@deepseek-ai/dsh-client-ui-conversation/presentation`
- `@deepseek-ai/dsh-client-ui-primitives/markdown`
- `@deepseek-ai/dsh-client-ui-tool/presentation`
- `@deepseek-ai/dsh-client-ui-workflow-run/presentation`
- `@deepseek-ai/dsh-client-ui-trajectory/presentation`

These faces re-export existing owner implementations. They do not create a second Session projection, copy browser definitions, mutate Session truth, or derive control state. The Runtime presentation face is mapped to the already loaded Runtime client instance inside browser bundles so the browser keeps one registry identity, while plain Node consumers load the neutral artifact.

Each face has an explicit package export, declaration entry, bundled runtime entry, and `files` payload. The TUI presentation export map checks package manifests, built declaration symbols, runtime symbols, packed import closure, plain-Node loading, and forbidden browser imports across the whole packed closure, not only the entry artifact. The map and gate are part of the repository build path.

The Typert host face excludes `./presentation` export subpaths: the faces re-export client business projections for plain Node, register no host services, and analyzing them in the host program would collide the client face's `agent` TypertContextMap declaration (same wire id and wire type as the host face's) into one program. The client face analysis still owns them.

## Alternatives considered

**Mount the browser client runtime from the TUI host.** Rejected: the TUI must not depend on React, DOM lifecycle, or browser object-layer registration.

**Import checkout-relative `src/*` paths.** Rejected: this would bypass package ownership, fail for registry consumers, and make the design depend on an unpublished checkout.

**Copy the Web projection definitions into the TUI plugin.** Rejected: it would create a second business projection owner and permit Web/TUI divergence.

**Create a generic presentation package owned by the TUI plugin.** Rejected: the DSH packages already own the definitions and parser; a new package would duplicate ownership instead of publishing the existing owner faces.

## Consequences

The TUI can consume the same published projection definitions and Markdown grammar as the WebUI through package exports. Registry publication of the DSH release family remains a separate release step; until the matching RC artifacts are published and verified from a clean install, the TUI implementation admission remains blocked.
