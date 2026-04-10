# Tool Caching Research

## Conclusion First

The GitHub evidence is consistent on one point: **tool-bearing agent requests should not be treated like ordinary semantic-cache candidates**.

The mature open-source patterns fall into four buckets:

1. **Exact request/response cache**
   Cache the full model response only when the request fingerprint is stable.
2. **Prompt-prefix caching**
   Cache stable `system` and `tools` prefixes separately when the upstream model supports provider-side prompt caching.
3. **Tool result / trajectory cache**
   Reuse tool work only with explicit validation of inputs and environment state.
4. **Lazy tool loading**
   Reduce token cost by not injecting every tool definition into every request.

No surveyed third-party project safely semantic-caches a full tool-bearing conversation transcript by default. That matches the current direction of this repository: **plain-text deterministic requests may use semantic lookup, but tool-bearing requests should stay exact-only unless a dedicated tool-result cache is added.**

## Surveyed Repositories

| Project | Link | What it does | Tool-related signal | Applicability here |
| --- | --- | --- | --- | --- |
| `6/openai-caching-proxy-worker` | https://github.com/6/openai-caching-proxy-worker | Exact response cache proxy for OpenAI-compatible traffic | `src/cache.ts` builds a cache key from `method`, `path`, `authHeader`, and a recursively key-sorted JSON body before hashing | Strong reference for exact cache keys on tool-bearing requests |
| `zcaceres/easy-agent` | https://github.com/zcaceres/easy-agent | Anthropic agent framework with prompt caching support | README documents caching order as `system` first, then `tools`, stopping at provider cache limits | Strong reference for prompt/tool prefix caching, not for replaying tool outputs |
| `montevive/autocache` | https://github.com/montevive/autocache | Anthropic cache proxy with automatic breakpoint injection | README explicitly targets large system prompts, 10+ tool definitions, and repeated agent interactions; cache strategies prioritize `system`, `tools`, and then content blocks | Strong reference for separating prefix caching from response caching |
| `askbudi/tinyagent` | https://github.com/askbudi/tinyagent | Agent framework with Anthropic prompt cache hook | Hook reserves the final two messages for recency and inserts cache breakpoints into older prompt segments and tool context | Useful reference for cache breakpoint placement around agent history |
| `pig-dot-dev/muscle-mem` | https://github.com/pig-dot-dev/muscle-mem | Behavior cache for agent tool trajectories | Replays tool trajectories only after `Check` validation; supports `pre_check`, `post_check`, and dynamic `params` mapping | Strong reference for a future tool-result cache with safety guards |
| `voicetreelab/lazy-mcp` | https://github.com/voicetreelab/lazy-mcp | Loads MCP tools on demand instead of injecting all tool definitions into context | README focuses on preventing unused tools from polluting the context window and routes all execution through meta tools | Strong reference for reducing tool-token pressure before caching |
| `withakay/opencode-codex-provider` | https://github.com/withakay/opencode-codex-provider | Codex-related provider bridge for OpenCode | Caches provider/model instances in a state map and lazy-loads the MCP server; does not implement request token cache | Useful negative signal: Codex ecosystem repos focus on provider/tool activation more than response caching |
| `codefuse-ai/ModelCache` | https://github.com/codefuse-ai/ModelCache | Semantic cache service for LLMs | Supports system instructions and multi-turn dialogues, but is still generic semantic retrieval rather than tool-aware replay | Good reference for semantic cache boundaries on plain-text requests only |
| `zilliztech/GPTCache` | https://github.com/zilliztech/GPTCache | Generic semantic cache library | README highlights exact match, similar-match, similarity thresholds, and temperature-aware cache skipping | Good reference for semantic cache mechanics, not for tool-bearing transcript reuse |

## Repository Notes

### 1. `6/openai-caching-proxy-worker`: exact hash over normalized request body

Relevant implementation:
- `src/cache.ts` recursively sorts JSON keys before hashing.
- The key input includes request method, path, auth header, and request body.

What matters for us:
- Tool requests are safe to reuse only when the request body is normalized first.
- Stable hashing is more important than semantic similarity once tools enter the request.

Direct implication:
- Our exact fingerprint should continue to include tool declarations, tool choice, and normalized tool-call history.
- Transient ids should not split the cache if the actual tool name and arguments are unchanged.

### 2. `easy-agent`: provider-side prompt caching is prefix-oriented

Relevant documentation:
- Prompt caching order is `system` first, then `tools`.
- Tool order matters because caching stops when provider limits are reached.

What matters for us:
- This is not full-response caching.
- It is a cost-optimization layer for stable prompt prefixes.

Direct implication:
- If we later add upstream-native prompt caching for OpenAI-compatible providers, we should treat `instructions/system` and tool schemas as a separate cacheable prefix.
- That should not be mixed with semantic replay of entire tool-bearing conversations.

### 3. `autocache`: tools are cached as prompt prefixes, not semantic replies

Relevant documentation:
- The project explicitly targets large system prompts, 10+ tool definitions, and repeated agent interactions.
- Cache strategies are `conservative`, `moderate`, and `aggressive`.
- Breakpoints prioritize `system`, `tools`, and then large content blocks.

What matters for us:
- Tool definitions are treated as stable prompt material.
- The optimization is about token reuse on the provider side, not about blindly replaying tool outputs.

Direct implication:
- Our dashboard and docs should separate:
  - exact response cache,
  - semantic cache,
  - provider-native prompt prefix cache,
  - future tool-result cache.

### 4. `tinyagent`: cache breakpoints keep recent interaction uncached

Relevant documentation:
- The Anthropic prompt cache hook inserts `cache_control` markers into older prompt segments.
- The final two messages are intentionally kept outside the cached prefix.

What matters for us:
- Even in agent frameworks that embrace prompt caching, the newest conversational turns stay dynamic.
- Tool-heavy transcripts are not flattened into a single monolithic cache key for semantic reuse.

Direct implication:
- If we later add prompt-prefix support, we should preserve a dynamic tail for the latest user/tool exchange.

### 5. `muscle-mem`: tool reuse needs validation, not only matching text

Relevant documentation:
- It records tool-calling trajectories.
- Replay is guarded by `Check` objects with `capture` and `compare`.
- `pre_check` and `post_check` validate whether the environment still matches.
- Dynamic parameters are separated from static trajectory data.

What matters for us:
- This is the strongest third-party evidence for a future tool-result cache.
- Safe tool reuse depends on environment validation and parameterization, not only on prompt equality.

Direct implication:
- A future tool-result cache in this repository should be separate from full-response cache.
- The key needs at least:
  - tenant / account isolation,
  - tool name,
  - canonical arguments,
  - tool schema version,
  - environment fingerprint,
  - TTL / freshness policy,
  - side-effect classification.

### 6. `lazy-mcp`: cut tool-token cost before adding more cache complexity

Relevant documentation:
- It exposes two meta tools and loads actual MCP tools only on demand.
- The goal is to stop unused tools from polluting the context window.

What matters for us:
- Many tool-token problems should be solved upstream by shrinking tool exposure.
- This is especially relevant for Codex and agent-style workflows with large MCP catalogs.

Direct implication:
- Do not assume every tool schema belongs in every cached request.
- If a client can lazily expose tools, cache hit rate and token efficiency both improve.

### 7. Codex ecosystem signal: caching is often about provider/tool activation, not transcript replay

Relevant documentation:
- `opencode-codex-provider` caches provider/model instances and lazy-loads the MCP server.
- It does not implement prompt-response token caching.

What matters for us:
- Codex-adjacent open-source work today is mostly about bridging providers, approvals, streaming events, and tool activation.
- That means we should be cautious about inventing Codex-specific cache semantics without source support.

Direct implication:
- For Codex requests, the safest documented strategy is still:
  - exact whole-response cache for tool-bearing requests,
  - semantic cache only for plain-text deterministic requests,
  - separate future layer for validated tool-result reuse.

### 8. `ModelCache` and `GPTCache`: semantic caches stay generic

Relevant documentation:
- Both projects focus on semantic similarity, embeddings, vector recall, thresholds, and exact-vs-similar match modes.
- `ModelCache` adds support for system instructions and multi-turn dialogues.
- `GPTCache` explicitly supports exact match, similar match, and temperature-aware cache skipping.

What matters for us:
- These projects are useful for the plain-text branch.
- They do not provide a convincing safety story for semantic replay of tool-bearing agent transcripts.

Direct implication:
- Semantic caching should remain scoped to requests whose behavior is dominated by stable text intent rather than tool execution state.

## Tool Documentation for This Repository

### A. Full-response cache

Use when:
- the entire model response can be replayed as-is.

Rules:
- Plain-text deterministic requests may use `semantic_first`, with exact fallback.
- Tool-bearing requests must use `exact_only`.
- Exact keys must include stable request semantics:
  - model,
  - instructions/system,
  - messages/input,
  - tool schemas,
  - `tool_choice`,
  - tool call history,
  - function call outputs,
  - response-format knobs that affect output.
- Exact keys must ignore transient ids that do not change semantics.

### B. Prompt/tool prefix cache

Use when:
- the upstream provider supports server-side prompt caching or cache breakpoints.

Rules:
- Cache stable `system` / `instructions` first.
- Cache tool declarations next.
- Keep the newest interaction tail dynamic.
- Treat this as a token-cost optimization layer, not as permission to replay old tool outputs.

### C. Tool-result cache

Use when:
- a tool is pure or safely replayable under explicit validation.

Rules:
- Separate namespace from model-response cache.
- Key by tenant, tool name, canonical args, schema version, and environment fingerprint.
- Require a freshness policy.
- Require a side-effect policy:
  - pure/read-only tools may be replayable,
  - mutating tools should default to no replay unless there is explicit approval and validation.
- Keep validation logic close to the tool contract, not hidden inside generic semantic matching.

### D. Lazy tool loading

Use when:
- large tool catalogs are inflating prompt size and reducing cache efficiency.

Rules:
- Prefer exposing a smaller active tool surface.
- Load tool definitions on demand when the client/runtime supports it.
- Measure token savings separately from cache hit rate.

## Recommended Policy for `claude-relay-service`

### Keep

- Keep `semantic_first` for plain-text deterministic requests.
- Keep `exact_only` for requests carrying tool declarations, `tool_choice`, `function_call`, `function_call_output`, or assistant tool-call history.
- Keep exact fallback when semantic lookup/store fails on very long prompts.

### Do next

1. Add a dedicated tool-result cache instead of trying to semantic-cache whole tool transcripts.
2. Classify tools before reuse:
   - pure/read-only,
   - idempotent but freshness-sensitive,
   - side-effecting / never replay.
3. Version tool schemas in cache keys so tool contract changes invalidate old entries.
4. Surface tool cache metrics separately in the dashboard:
   - exact response hits for tool-bearing requests,
   - tool-result hits,
   - skipped tool replays due to validation failure,
   - prompt-prefix savings if provider-native caching is added later.

### Do not do

- Do not semantic-cache a full tool-bearing transcript just because embeddings are available.
- Do not replay tool outputs without environment validation.
- Do not mix prompt-prefix caching and response replay into one undifferentiated "tool cache" number.

## Source Links

- `6/openai-caching-proxy-worker`: https://github.com/6/openai-caching-proxy-worker
- `6/openai-caching-proxy-worker/src/cache.ts`: https://raw.githubusercontent.com/6/openai-caching-proxy-worker/main/src/cache.ts
- `easy-agent`: https://github.com/zcaceres/easy-agent
- `autocache`: https://github.com/montevive/autocache
- `tinyagent`: https://github.com/askbudi/tinyagent
- `tinyagent` Anthropic prompt cache hook: https://raw.githubusercontent.com/askbudi/tinyagent/main/tinyagent/hooks/anthropic_prompt_cache.py
- `muscle-mem`: https://github.com/pig-dot-dev/muscle-mem
- `lazy-mcp`: https://github.com/voicetreelab/lazy-mcp
- `opencode-codex-provider`: https://github.com/withakay/opencode-codex-provider
- `ModelCache`: https://github.com/codefuse-ai/ModelCache
- `GPTCache`: https://github.com/zilliztech/GPTCache
