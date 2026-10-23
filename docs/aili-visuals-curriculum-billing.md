# Aili: Visual Assets, Completing Robotics, AI Roles and Billing (v0.2)

**Status:** design draft, nothing here is implemented. v0.1 written 2026-10-09 with Lucky; v0.2 aligns the palette with the brand doc.
**Companions:** `aili-architecture.md`, `aili-professor-behavior-spec.md`, `aili-stage-layout.md`, `aili-brand-design-language.md`.
**Verification note:** facts about licenses, tools and payment providers below were checked on 2026-10-09 from the pages named, several of which are secondary or competitor-written. Re-verify anything you rely on commercially, and get legal advice on licensing, tax and consent.

---

## 1. Where the visuals come from and how they enter Aili

Every visual is a registry item (see the architecture document) with `provenance`, `license`, `source`, `fidelity`, `review_status` and `version`. Nothing reaches a learner unless it is in the registry and published.

### 1.1 Sources, in order of preference

| Source | Good for | License and risk notes |
|---|---|---|
| **Authored in-house** (Blender, CAD, or code) | The core robot, servo cutaway, analogy cast, force and lever-arm graphics | You own it. Highest quality and consistency. Costs time. Claude Code can write procedural models in code (for example Three.js geometry), which a person then reviews. |
| **Commissioned** (freelance 3D artist or an animator) | The signature analogy cast and polished hero assets | Get a written assignment of rights. Specify file format (glTF/GLB), named parts, polygon budget, and style guide. |
| **Open-licensed libraries** | Props, background elements, generic parts | Read each item's license. Sketchfab's downloadable models carry Creative Commons licenses: attribution (CC BY) is required, **non-commercial (CC BY-NC) cannot be used in a paid product**, no-derivatives (CC BY-ND) cannot be modified, and share-alike (CC BY-SA) obliges you to share derivatives under the same license. Models under CC0 or Sketchfab's Standard license need no credit. Record the license and author in the registry. |
| **NASA 3D Resources** | Space and aerospace models (for future modules) | The repository README says the assets are free and without copyright, but points to NASA's usage guidelines, which must be read, and its contributor list includes non-NASA organizations whose terms are not stated there. Check each asset. |
| **Manufacturer CAD (STEP files for servos, boards)** | Real part geometry | Usually allowed for design use, but redistribution terms vary. Read the terms or ask in writing. Never present a generic model as a manufacturer's internals. |
| **Community project files (printables, forums)** | Hobby parts | Licenses vary, many are non-commercial. Same registry rules. |
| **AI-generated** | Fast drafts, props, illustrations | See section 2. Never the first choice for anything engineering-critical. |

### 1.2 Pipeline into the library

1. **Acquire** and record the license, author, source URL and date in a manifest.
2. **Normalize:** export to glTF/GLB, set real-world scale (metres), name every part (these names become object IDs), check axes and origin.
3. **Optimize:** reduce polygons, compress meshes and textures, set a size budget per asset so the stage loads on a mid-range Android phone and a slow connection. Use tools such as glTF Transform or Blender; test on the lowest-end target device.
4. **Annotate:** a card per part (function, fidelity note, source), camera presets, ghost and exploded-view presets, and a reduced-motion alternative.
5. **Automated checks:** schema, unique part IDs, size, texture limits, license field present, no missing references.
6. **Expert review:** a person checks that the labels and claims are right.
7. **Publish** a versioned item. The AI cannot publish.

### 1.3 Rules for assets

- **Fidelity labels are required:** *verified model*, *simplified teaching model*, or *illustrative*.
- **No invented anatomy of a named real product.** If accurate internals are unavailable, show a generic layout and say it is generic.
- **Style guide:** use the brand palette and tokens from `aili-brand-design-language.md` (Canvas, Ink, Copper, Sage, Sky, Gold, Plum), one line weight and one label style, so assets from different sources look like one system.
- **Attribution:** keep a credits page generated from the registry, and show attributions where a license requires them.

---

## 2. AI-generated visuals: allowed, tiered and always labeled

Yes, Aili can use AI-generated visuals when nothing suitable exists, with strict tiers and labels. The risk is not that the picture looks bad. The risk is that it looks convincing and is **wrong**, and a learner trusts what they see.

### 2.1 Tiers

| Tier | What | When | Label shown to the learner |
|---|---|---|---|
| **T0: Library asset** | Authored or licensed, reviewed | Preferred | Verified model, or simplified teaching model |
| **T1: AI-composed from the library** | The AI assembles existing primitives, cast and props through a constrained scene description (allowed shapes, transforms, colors, motion; bounded counts and sizes; validated labels) | Runtime, when no exact asset exists | **Illustrative (AI-composed). No verified model.** |
| **T2: AI-generated 2D diagram** | Vector graphics generated within a restricted vocabulary and sanitized (no scripts, no external references) | Runtime, simple diagrams only | **AI-generated illustration** |
| **T3: AI-generated 3D mesh or animation** | Output of an image-to-3D or text-to-3D tool, or AI-drafted animation | **Authoring pipeline only**, never live for learners | After review: **AI-generated, human-reviewed.** Before review: not visible to learners |

Why T3 is offline only: generated meshes are strong on overall form and texture but weak on fine mechanical detail, clean edges and internal structure, and often have messy geometry that animates badly, so they need cleanup. Latency, cost, safety and licensing also make live generation a poor fit. Free tiers of hosted tools may carry attribution or non-commercial terms, and commercial rights are often tied to paid plans, so confirm the exact tool and tier. Self-hosted open models have their own licenses. Some marketplaces refuse AI-generated assets. Purely AI-generated work may also be hard to protect, so re-detailing and composing it strengthens your claim.

### 2.2 Simulations are different

An animation is not a simulation. If a learner asks to "simulate" something with no solver in the registry:
- Aili says there is **no verified simulation** for it.
- It may show an **illustrative animation** (T1) labeled "Illustrative animation, not a simulation".
- It logs the request as demand, and may draft a simulation definition into the **authoring queue** for a person to build and test. It never runs model-written code in the live app.

### 2.3 Hard rules

- AI-generated visuals never show as authoritative for: wiring diagrams, anatomy of a named product, safety-critical procedures, dimensions or tolerances. If shown at all, they carry a strong "unverified, do not wire or build from this" label.
- Every visual's provenance is stored in the registry and visible in the interface (a small, accessible badge, readable by screen readers).
- A "report a problem with this visual" action is available on every scene, and reports go to a review queue.
- Validate bounds, labels, object references and resource use for all runtime-composed scenes.
- Log which tier was used per turn, so you can see which missing assets matter most and build them first.

```json
{
  "id": "asset.servo-camera-arm",
  "type": "asset",
  "version": "0.1.0",
  "provenance": "authored",
  "fidelity": "simplified_teaching_model",
  "license": { "id": "owned", "author": "Aili", "attribution_required": false },
  "format": "glb",
  "size_kb": null,
  "parts": ["base", "board", "servo", "horn", "arm", "camera"],
  "review_status": "draft"
}
```

```json
{
  "id": "scene.runtime.0831",
  "type": "composed_scene",
  "provenance": "ai_composed",
  "label": "Illustrative (AI-composed). No verified model.",
  "elements": [
    { "shape": "box", "size": [1, 0.2, 0.2], "color": "sage", "motion": { "type": "rotate", "axis": "z", "rad_per_s": 0.5 } },
    { "shape": "label", "text": "Joint", "position": [0, 0.5, 0] }
  ],
  "limits": { "max_elements": 12, "max_extent": 6, "max_text_chars": 30 }
}
```

---

## 3. What the AI does with the robotics topics

Three jobs, all with the library as ground truth:

**A. At runtime (per learner):** choose, sequence, adapt and explain.
- Explain concepts clearly (intuition, mechanism, equation and its assumptions, visual, analogy), pitched at the learner's level.
- Probe, challenge, debate, assign readings and run teach-backs (see the behavior spec).
- Build the study plan from the concept graph, and pick the right lab, analogy, reading and project step from a shortlist.
- Review designs in the Build Workbench and propose changes the learner accepts or rejects.
- Compose illustrative scenes (T1) when an exact asset is missing, always labeled.

**B. At authoring time (for you, with review):** draft, never publish.
- Draft concept nodes and prerequisites for the graph.
- Draft reading guides (key claims, misconceptions, teach-back and application questions) for items a person has verified.
- Draft analogy mappings and "where it breaks" notes.
- Draft solver code and tests from textbook worked examples, and manifests for simulations.
- Draft scene scripts and animation descriptions, and use T3 tools for mesh drafts.
- Everything enters a review queue and needs a human approver.

**C. In maintenance:**
- Weekly link checks on the reading library, and flags for stale items.
- Summaries of new robotics developments into **candidate** Frontier cards for a person to verify against primary sources.
- Clustering of "unsupported question" logs into a ranked list of what to build next.

**The AI does not:** invent physics, assets or numbers for the live library; publish content; invent sources, chapter numbers or specifications; or present an illustration as a simulation.

---

## 4. How to complete the robotics coverage

"Complete" cannot mean every concept as a hands-on lab. A realistic definition: **a complete map, with depth added where demand and quality justify it.**

### 4.1 Stages

| Stage | Goal | Contents | Gate to next stage |
|---|---|---|---|
| **0: The map** | The whole field is visible | Concept graph for all domains at node level (title, prerequisites, level descriptions, coverage tag). Likely a few hundred nodes. AI drafts, a working roboticist reviews, and you compare against standard syllabi and texts. | Reviewer sign-off on structure |
| **1: V1 depth** | A small part done properly | About 40 concepts deep: the three labs (feedback control with a drone holding its altitude, then servo load and inside the servo), two analogies (cruise control on a hill for feedback, a bag held at arm's length for torque), a seed reading library of 30 to 40 guided items, one project template, a handful of Frontier cards | Beta users complete the loop and show learning on the transfer question |
| **2: Guided breadth** | Every domain gets honest guided coverage | Explanations with labeled generic robots, T1 illustrations, guided readings with human-written guides | Review of each domain's guided content |
| **3: Labs by demand** | The next labs are chosen by evidence | Rank by: unsupported-question volume, learner drop-off points, project needs, expert availability. Likely candidates: kinematics of a 2-joint arm, sensor basics, power budgeting, motor sizing, mobile-robot driving | Each lab passes solver tests and expert review |
| **4: Breadth by partners** | Scale beyond what you can author | University lecturers, kit makers and maker clubs contribute under your contract and review standards | Contribution and review process works |

### 4.2 Cost and time

- Stage 0 is days to a few weeks with an expert reviewer.
- Each lab takes roughly a couple of weeks of focused work including solver, asset, tests and review. This is my estimate from similar work, not a measured figure, so track your real numbers on the first lab and adjust.
- The scarce resource is **expert review time**, not AI drafting. Plan to pay reviewers (cash, credit, or shared revenue from content they help produce).

### 4.3 Seeds

Use standard textbooks and open course syllabi to check completeness of the map. Seeds to verify before use (from memory, not checked): Lynch and Park, *Modern Robotics*; Craig, *Introduction to Robotics*; Siegwart and colleagues on autonomous mobile robots; Thrun, Burgard and Fox, *Probabilistic Robotics*; official ROS 2 documentation. Do not copy their text. Write your own guides.

---

## 5. Billing: how to earn something

You asked how to bill, not what to charge. Treat this as: **what you bill for, how you collect, how you protect your margin, and what to prove first.**

### 5.1 What to bill for

Charge for what creates value **and** costs you money. Local 3D rendering and in-browser simulation cost almost nothing per learner. Model calls, voice and support do cost money.

| Candidate | Why it works | Watch out |
|---|---|---|
| **Guided project pack (one-time)** | A clear value event, low commitment, simple to explain, easy to collect once | Make sure the AI cost of a project is covered |
| **Subscription with a fair-use AI allowance** | Predictable revenue for ongoing learners and builders | Heavy users can cost more than they pay. Cap the allowance |
| **Credits or top-ups for voice and heavy AI** | Matches price to your largest variable costs | More friction. Introduce only if voice costs warrant it |
| **Club or institutional pilot (invoiced)** | Higher revenue per sale, learners come as a cohort, strong evidence for investors | Slow sales. Needs onboarding and an outcomes report |
| **Kit partnership or referrals** | Revenue from parts people buy anyway | Can bias recommendations. If used, disclose it and keep recommendations driven by evidence |

The pricing hypotheses in your master prompt (free Explore, Project pack, Builder beta, Club pilot, Institutional pilot, Kit partnership) are consistent with this. They remain hypotheses to test. Billing is unresolved: no forced paywall or trial tollbooth in the beta.

### 5.2 Protect the margin

- **Meter every session:** model tokens in and out, voice seconds or characters, retrieval, and hosting. Store provider, model and unit prices from your own configuration, because list prices change.
- **Contribution per learner** = revenue minus (AI + voice + hosting + payment fees + support). Know this number per plan before you scale.
- **Cap the free tier by cost,** not only by time: a per-session cost cap, a daily limit, rate limits, and a global kill switch with alerts on spikes.
- **Show usage honestly** to learners, and do not bill for time spent manipulating a locally rendered scene.
- **Route models by need:** cheap router for classification, mid-tier professor for teaching, no top-tier model per learner. Cache popular explanations and analogy storyboards.

### 5.3 How to collect (Kenya-aware, verify before committing)

Findings from 2026-10-09:
- **Stripe:** a 2023 article by a competing Kenyan gateway says Stripe is not supported for businesses in Kenya, with offshore company registration as a workaround that loses M-Pesa and adds currency conversion. This is a secondary, competitor source and may be out of date. **Check Stripe's own supported-countries page.**
- **Paystack:** its own post (2023-08-31) says it is live for all merchants in Kenya, accepting cards, M-PESA and Apple Pay, settling in KES and USD, and open to individuals as a "Starter Business". Confirm current terms and fees.
- **M-Pesa directly:** Safaricom's Daraja developer portal lets companies or individuals register and use a sandbox. Its landing page does not state go-live requirements, so read the detailed guides before relying on direct integration.
- **Merchant of record (handles tax collection and invoicing for global digital sales):** Polar's documentation lists Kenya among payout countries (paid through Stripe Connect). I could not confirm Kenya for **Paddle** because its seller list is behind a partner login. Confirm payout and tax handling with any provider before choosing.
- **Tax and registration:** VAT, income tax, business registration and consent for beta data are legal matters. Get advice from a Kenyan accountant or lawyer before you take real money.

### 5.4 Sequence

1. **Beta (now):** free, cost-capped, measure value. Collect a waitlist.
2. **First revenue test:** a payment link or invoice for a project pack or a club pilot. No billing engine yet. The aim is to learn whether anyone pays and why.
3. **Subscriptions and metering:** build only after repeat usage is visible. Add the internal ledger and allowances.
4. **Institutional invoicing:** run a paid pilot with a club or school and produce an outcomes report from your learning data.

For investors, a handful of **real paid pilots** with usage data is stronger evidence than a billing system.
