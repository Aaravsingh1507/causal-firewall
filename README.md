# Causal Firewall

An open-source prototype of an evidence-first remediation gate for distributed systems. Causal Firewall tests a candidate fix on a small shadow cohort and only opens the gate when the target metric improves. The MVP is intentionally local and deterministic: it demonstrates the decision flow without touching production systems.

## Product idea

Traditional observability tells an operator what correlates with an incident. Causal Firewall asks a sharper question: **if we change this thing, does the incident actually improve?**

The demo models two incidents:

- A retry storm after database latency, where stopping retries is the causal intervention.
- Cache drift causing stale pricing, where invalidating stale keys is the causal intervention.

Each evaluation produces a trace: incident request → collected signals → intervention hypothesis → metric delta → policy rule → decision.

## Design plan

The project follows one focused journey:

```text
Console → Run scenario → Choose hypothesis → Evaluate shadow cohort → Inspect causal trace
```

- **Console** shows the posture, decision history, and the product principle.
- **Run scenario** lets a reviewer choose an incident, intervention, and policy rules.
- **Causal trace** makes the evidence chain inspectable node by node.
- **Policy engine** is pure and deterministic, so the important behavior can be tested without the UI.

This is a six-day buildathon MVP, not a production control plane. It does not connect to Kubernetes, cloud APIs, telemetry providers, or real infrastructure.

## Run locally

```sh
npm install
npm run dev
```

Open the localhost URL printed by Vite. Create a production build with `npm run build`; the deployable site is in `dist/`.

## Test

```sh
npm test
```

The test suite covers the causal decision boundary, policy bypass behavior, and history aggregation.

## Demo path

1. Open the **Run scenario** tab.
2. Keep **Retry storm** selected and choose **Apply retry budget**.
3. Click **Evaluate intervention**.
4. Inspect the decision: the gate opens because the shadow cohort shows a causal improvement.
5. Return to the simulator, choose **Clear Redis cache**, and evaluate again.
6. Inspect the trace: the gate is held because the intervention did not improve the metric.
7. Toggle off **Require causal improvement** and replay to see the policy boundary change.

## Structure

```text
index.html                 application shell
styles.css                 dark observability console design system
src/main.js                route rendering and interactions
src/domain/fixtures.js     incidents, signals, interventions, policy
src/domain/policy-engine.js pure evaluation and summaries
src/state/store.js         small in-memory application store
test/policy-engine.test.js behavior tests using node:test
```

## Verification

- `npm test` — run the policy-engine behavior suite.
- `npm run build` — create the deployable Vite bundle.
- `npm run dev` — start the local demo.
