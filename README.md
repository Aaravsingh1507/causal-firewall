# Causal Firewall

> **"An AI-powered safety gate for websites and web apps that proves a fix works before letting it touch 100% of your users."**

**Live Web App**: [https://causal-firewall-main.vercel.app](https://causal-firewall-main.vercel.app)  
**GitHub Repository**: [https://github.com/Aaravsingh1507/causal-firewall](https://github.com/Aaravsingh1507/causal-firewall)

---

## What is Causal Firewall? (In Plain Words)

When a website or web app breaks (e.g. checkout spins forever, server throws 504 Bad Gateway, or database runs out of connections), developers and automated AI bots usually **guess** a solution:
* *"Let me restart the server!"*
* *"Let me clear the cache!"*
* *"Let me upgrade the server RAM!"*

Most of the time, guessing makes things **worse**. Restarting a server might bring it down for everyone, or kick shoppers out of checkout, while the underlying bug remains untouched.

**Causal Firewall stops guessing.**
1. **The AI Diagnostic Engine** analyzes your real website error logs and diagnoses the true root cause.
2. It generates **3 candidate fixes** and provides a ready-to-use code solution.
3. Instead of blindly pushing that fix to 100% of your visitors, **Causal Firewall tests it on a safe 5% slice of traffic (a shadow cohort)**.
4. If the speed improves and errors drop ($p < 0.05$), the **Gate OPENS** and the fix is approved. If it doesn't work, the **Gate HOLDS (Blocks)**, protecting the other 95% of your users from a broken fix!

---

## Why Does It Exist? (Its Purpose)

1. **Stop Outage Panic**: During a downtime incident, it replaces panicky guesswork with evidence.
2. **Prevent AI Hallucinations in Production**: AI agents are great at generating code patches, but they can hallucinate bad fixes that delete data or break APIs. Causal Firewall acts as an **automated bouncer** that demands statistical proof before any AI fix is rolled out globally.
3. **Zero-Risk 5% Testing**: If a fix fails or makes latency worse, only 5% of simulated traffic felt it. The other 95% of real users are never harmed.
4. **Instant Code Solutions**: Gives developers the exact, copy-pasteable code snippet to fix their problem in Node.js, Next.js, Express, React, or Cloudflare.

---

## How to Use It for Different Tasks

### Task 1: Diagnose a Real Website Error with the AI Doctor
1. Click **`03 AI Doctor`** in the left sidebar (or press <kbd>3</kbd> on your keyboard).
2. Paste any real error log, stack trace, or describe your problem in simple English:
   > *"Our Next.js checkout page freezes on /api/checkout and throws 504 Gateway Timeout during flash sales."*
   *(Or click one of the quick template pills at the top!)*
3. Click **"Diagnose & Generate Fixes"**.
4. In under 2 seconds, the AI engine will give you:
   * **Root Cause Explanation**: Why it broke in simple words.
   * **Anti-Hallucination Audit**: Confirms why the fix is safe.
   * **3 Candidate Fixes**: One causal fix, one common trap, and one useless guess.
   * **Copy-Paste Code Patch**: Ready to drop into your website's code!
5. Click **"Test 5% Shadow Cohort"** on any fix to see Causal Firewall run the statistical verification!

---

### Task 2: Test a Server Fix on a 5% Shadow Cohort
1. Click **`02 Run scenario`** (or press <kbd>2</kbd>).
2. Select any of the **8 built-in real-world incidents** (Retry storm, Cache drift, DNS failure, Memory leak, Disk saturation, etc.) or your AI-generated incident.
3. Select an intervention you want to try (e.g. *Restart API* vs *Apply retry budget*).
4. Click **"Evaluate intervention"** (or press <kbd>E</kbd>).
5. Watch the decision:
   * **Gate Opened (Green)**: The metric improved by over 70%, $p < 0.05$. Safe to roll out!
   * **Gate Held (Amber)**: The fix only masked symptoms or didn't improve the metric. Held for safety!
*(Tip: Click **"Batch all"** or press <kbd>B</kbd> to test all 3 fixes simultaneously in one click!)*

---

### Task 3: Inspect the Step-by-Step Evidence (Causal Trace)
1. Click **`04 Causal trace`** (or press <kbd>4</kbd>).
2. Click through the 8 visual nodes of the pipeline:
   $$\text{Request} \longrightarrow \text{Signals} \longrightarrow \text{Hypothesis} \longrightarrow \text{Metric Delta} \longrightarrow \text{Policy Rules} \longrightarrow \text{Gate Decision}$$
3. Click any node to inspect $p$-values, effect sizes, and the firewall's plain-English directive.

---

### Task 4: Compare Two Fixes Side-by-Side
1. Go to **`01 Console`** (press <kbd>1</kbd>).
2. In the **Decision History** list, click the small compare icon (`⇆`) next to any two evaluations.
3. Click **"Compare selected"**.
4. A side-by-side modal opens showing:
   * Confidence delta (e.g. *Fix A had +69% higher statistical confidence than Fix B*).
   * Metric deltas compared side-by-side.
   * The winning fix highlighted in bright cyan.

---

### Task 5: Build a Custom Scenario for Your Company
1. Click **`05 Scenario builder`** (press <kbd>5</kbd>).
2. Fill out the form with your company's service name, incident description, and 3 possible fixes.
3. Click **"Save scenario"**.
4. It is immediately available in your library and runnable in the simulator!

---

### Task 6: Export Reports for Post-Mortems
1. Go to **`01 Console`** or **`06 Settings`**.
2. Click **"Export JSON"** or **"Export CSV"**.
3. Downloads a clean, formatted spreadsheet of all evaluations, confidence scores, and reasons for your engineering post-mortem or compliance review.

---

### Task 7: Connect It to a Live Real Website in Code
In real life, you route 5% of traffic using your website's middleware (Next.js, Express, or Cloudflare Workers):

```javascript
// middleware.js (in your Next.js or Express app)
export function middleware(req) {
  // 1. Send only 5% of visitors to test the emergency fix
  const isShadowUser = Math.random() < 0.05;

  if (isShadowUser) {
    // 5% test the experimental fix
    return NextResponse.rewrite(new URL('/api/checkout-experimental', req.url));
  }

  // 95% stay on the normal safe site
  return NextResponse.next();
}
```

Then your deploy script checks with Causal Firewall:
```javascript
const res = await fetch('http://localhost:5173/api/evaluate', {
  method: 'POST',
  body: JSON.stringify({ metricDelta: '-85%', fix: 'add-timeout' })
});
const { decision } = await res.json();

if (decision === 'allow') {
  deployTo100Percent(); // Gate opened! Roll out everywhere!
} else {
  revertShadowTraffic(); // Gate held! Do not break production!
}
```

---

## Keyboard Shortcuts

| Key | Action |
|---|---|
| <kbd>1</kbd> | Go to Console |
| <kbd>2</kbd> | Go to Simulator |
| <kbd>3</kbd> | Go to AI Incident Doctor |
| <kbd>4</kbd> | Go to Causal Trace |
| <kbd>5</kbd> | Go to Scenario Builder |
| <kbd>6</kbd> | Go to Settings |
| <kbd>E</kbd> | Evaluate selected intervention |
| <kbd>B</kbd> | Batch evaluate all 3 interventions |
| <kbd>T</kbd> | Toggle light / dark theme |
| <kbd>?</kbd> | Show keyboard cheat sheet |
| <kbd>Esc</kbd> | Close any open modal |

---

## How to Run Locally

```sh
npm install
npm run dev
```

Open **`http://localhost:5173/`** in your browser.

To run the automated test suite:
```sh
npm test
```
*(41 automated unit tests covering the AI engine, policy engine, statistical z-scores, and storage).*

To create a deployable production build:
```sh
npm run build
```

---

## Project Structure

```text
index.html                 Shell, header pills, theme toggles, modal roots
styles.css                 Observability console design system (dark & light modes)
src/
  main.js                  Controller, router, event delegation, AI doctor UI
  state/
    store.js               Reactive state, persistence, search, comparison, AI dispatch
  domain/
    gemini.js              AI diagnostic API client, anti-hallucination audits
    fixtures.js            8 real-world failure scenarios & signals
    policy-engine.js       Pure policy gate, batch testing, comparison diffs
    statistics.js          Normal CDF math, z-scores, p-values, effect sizes
    storage.js             LocalStorage persistence, JSON/CSV exports
test/
  gemini.test.js           Live AI API integration tests
  policy-engine.test.js    Decision boundary and scenario tests
  statistics.test.js       Normal distribution and confidence tests
  storage.test.js          Storage serialization and import/export tests
```
