---
description: "Optional next-message suggestions for DSH Web and Desktop profiles, with bounded background generation and editable composer insertion."
kind: "package-bundle"
---

# @aaroncarry/dsh-prompt-suggestions

English | [中文](README.zh.md)

## Summary

This optional profile layer suggests one next human message after a successful reply. It displays the suggestion in an empty composer; click, Tab, or Right Arrow fills the draft, and Enter sends it through the normal composer. Typing or Escape dismisses the suggestion. Suggestions use a separate bounded model request and never delay the main turn.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

### Compatibility and installation

This standalone plugin uses the existing Connection, Storage Domain, Session, and LLM services in DSH `0.2.0-rc.2` through `0.2.1-rc.2`. Its `engines.dsh` range (`>=0.2.0-rc.2 <0.3.0`) is the single requirement DSH checks; the peer ranges repeat it for installers. No DSH source or installed-runtime patch is required. Development dependencies link to a sibling `deepseek-harness` checkout; the packed installation uses only production dependencies and the application-provided peers. Fully quit Desktop before using its bundled `dsh` command to manage the Desktop profile.

Install the published package from npm in the profile you use:

```text
dsh plugin --profile desktop add @aaroncarry/dsh-prompt-suggestions@0.1.5
```

Replace `desktop` with `web` for the browser profile. Remove it with `dsh plugin --profile desktop remove @aaroncarry/dsh-prompt-suggestions`. To test an unpublished local build instead, run `pnpm install && pnpm pack` and pass the resulting tarball path to the same `dsh plugin ... add` command.

### Controls and configuration

Suggestions appear only after a successful top-level turn containing a new human message and an assistant text reply. They stay hidden while the agent is running, while the composer has text or attachments, or while a command owns the input. Accepting a suggestion edits the draft; it does not submit it. IME composition and modified keyboard gestures retain their normal behavior.

The profile layer supplies the following complete configuration. Override the `prompt-suggestions` row with a complete `config` object; DSH replaces a row's configuration rather than merging it.

| Setting | Installed value | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Enable future automatic requests. |
| `maxContextMessages` | `12` | Maximum recent human/assistant text messages. |
| `maxInputBytes` | `16384` | UTF-8 bound on the prediction instructions plus the complete JSON transcript. |
| `maxOutputTokens` | `128` | Auxiliary output-token budget. |
| `maxResponseBytes` | `32768` | Bound on the cumulative JSON-encoded stream chunks. |
| `maxSuggestionChars` | `160` | Maximum suggestion Unicode code points. |
| `timeoutMs` | `8000` | Auxiliary call deadline; adapters must honor cancellation. |
| `temperature` | `0.3` | Auxiliary sampling temperature. |
| `provider`, `model` | omitted | Use the completed turn's route; explicit overrides require both fields. |
| `reasoningEffort` | omitted | Optional adapter-supported effort, such as `off`; otherwise the auxiliary call uses the adapter default. |

Use a fast model or disable reasoning with an effort supported by that model when its default reasoning would consume the short output budget. Empty, multiline, oversized, truncated, tool-bearing, and unsuccessful outputs remain hidden. Failures are recorded in plugin-owned storage without interrupting the main turn.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

[cordis.patch.yml](cordis.patch.yml) adds one Host plugin row. The package's `dsh.client` metadata loads the browser half in both Web and Desktop. Host and Client programs compile separately, and shared Cordis and React modules remain external to their bundles.

The Host observes committed `session/event` notifications without appending new main-session events. After an eligible `turn/end`, it durably records the exact auxiliary input in its own `prompt_suggestions` storage domain, then starts generation. Each call includes a detached audit snapshot using existing `system/message`, `request/header`, and `user/message` events, plus its settlement and reported usage. An authenticated `/api/prompt-suggestions/watch` Connection channel supplies cancellable long-poll reads. New turns or inbox changes invalidate suggestions; late calls retain their own audit record without replacing newer suggestions. Unloading aborts generations, releases readers, drains provider work, and closes storage.

The Client registers `conversation.input.overlay` and inserts through the public revision-checked `InputActions.insertText`. Its scoped DOM binding uses `[data-composer-card]`, `[data-composer-placeholder]`, and the card's contenteditable element to hide the ordinary placeholder and handle acceptance keys. It neither imports Lexical nor accesses the private composer keyboard interface. Dictionary, stylesheet, slot, and DOM listeners all have disposers.

Suggestion reads verify the stored trigger against the live main-session log; insertion validity belongs to the existing input revision check. Audit records remain in plugin-owned storage when the plugin is removed and never affect main-session reconstruction.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Configuration layer](cordis.patch.yml)
- [Host lifecycle](src/engine.ts), [stream assembly](src/generate.ts), and [Client overlay](src/client/SuggestionOverlay.tsx)
- [DSH architecture](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md)

-----

<a id="model-experience"></a>
## Model Experience

**Main conversation:** no new prompts, tools, or assistant messages. The suggested text enters the main conversation only after the human sends the edited draft.

**Auxiliary request:** one additional call per eligible reply, using recent human and assistant text framed as JSON. System instructions, tool results, reasoning, and binary attachments from the main conversation are excluded. The exact auxiliary input, detached audit log, settlement, and reported usage are retained in plugin-owned storage; main Session logs contain no plugin events.

**Prediction instructions:** [the built-in prompt](src/prompt.ts) predicts what the user would naturally type next, requests 2–12 words matching their style, and allows empty output when no suggestion is appropriate. Empty output produces no visible suggestion.

**Tokens and KV cache:** generation incurs additional input/output cost under the configured bounds. This independently framed request does not preserve the main conversation's message prefix, so main-prefix KV-cache reuse is not promised. Local typing suppresses the display; it does not notify the Host to cancel a request already in progress.

-----

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

The package currently targets DSH `0.2.0-rc.2` through `0.2.1-rc.2` through its existing plugin APIs. Its composer DOM selectors are a compatibility dependency until DSH exposes public placeholder and keyboard-extension APIs. Only empty-draft suggestions are implemented; partial-text completion, multiple candidates, per-session preference controls, and feedback ranking are absent. Main-call statistics do not aggregate auxiliary usage; the plugin's stored call records retain it for inspection. Generations whose adapters ignore cancellation may delay plugin unloading until those adapters settle.

### Dev Note

<details>
<summary>Development and verification — click to expand</summary>

Run `pnpm run typecheck`, `pnpm test`, and `pnpm run build`. `pnpm run test:profile` launches a real isolated DSH Web profile through the source CLI and replaces only the external model with a deterministic adapter. It checks generation, acceptance, explicit sending, dismissal, typing suppression, browser reload, both themes, and reconstruction of persisted events without the plugin. This check needs a sibling DSH checkout at a release inside this package's `engines.dsh` range, built, with its Playwright Chromium installed; `DSH_REPO` selects a different checkout. `pnpm run test:install` instead drives an isolated profile through a CLI, and `DSH_INSTALLED_ROOT` points it at the installed Desktop's bundled CLI. Screenshots and logs are written under `.test-output`; temporary homes stay available for inspection. Unit tests include a recorded model-input and suggestion snapshot. No real-provider quality or latency measurement is claimed by the deterministic check.

</details>
