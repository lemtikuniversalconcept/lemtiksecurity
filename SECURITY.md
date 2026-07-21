# Security Policy

<div align="center">

<img src="https://raw.githubusercontent.com/lemtikuniversalconcept/lemtiksecurity/main/public/favicon.png" alt="Lemtik Security" width="80" />

<br/>

[![Reporting](https://img.shields.io/badge/Report%20a%20Vulnerability-security@lemtik.com.ng-FF6B35?style=for-the-badge&labelColor=080D1A)](mailto:security@lemtik.com.ng)
[![Response SLA](https://img.shields.io/badge/Response%20SLA-48%20Hours-00D4FF?style=for-the-badge&labelColor=080D1A)]()
[![Disclosure](https://img.shields.io/badge/Disclosure-Coordinated-00D4FF?style=for-the-badge&labelColor=080D1A)]()

</div>

---

> **Lemtik Security operates a civilian-grade C4I (Command, Control, Communications, Computers & Intelligence) platform handling real security operations data across Nigerian organisations and government agencies. We take every security report seriously — a vulnerability in this platform has real-world safety implications, not just technical ones.**

---

## 📋 Table of Contents

- [Supported Versions](#-supported-versions)
- [Reporting a Vulnerability](#-reporting-a-vulnerability)
- [What to Include](#-what-to-include)
- [What Happens After You Report](#-what-happens-after-you-report)
- [Scope](#-scope)
- [Out of Scope](#-out-of-scope)
- [Security Standards We Follow](#-security-standards-we-follow)
- [Our Commitments to Researchers](#-our-commitments-to-researchers)
- [Hall of Thanks](#-hall-of-thanks)

---

## 🔢 Supported Versions

We actively maintain and patch the following:

| Component | Version | Supported |
|-----------|---------|-----------|
| C4I Dashboard (this repo) | `main` branch | ✅ Active |
| Relationship API | `main` branch | ✅ Active |
| OSINT Brain | `main` branch | ✅ Active |
| Inventory Service | `main` branch | ✅ Active |
| Route Calculator | `main` branch | ✅ Active |
| Proximity Finder | `main` branch | ✅ Active |
| Autonomous Control Layer | `main` branch | ✅ Active |
| Master AI Agent | `main` branch | ✅ Active |
| Any tagged release older than 90 days | — | ⚠️ Best effort |
| Any branch other than `main` | — | ❌ Not supported |

> Security patches are applied to `main` only. If you are running a forked or pinned version, update to `main` immediately upon notification of a critical patch.

---

## 🚨 Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

This repository handles code for a platform that protects real people in real security situations. A public vulnerability disclosure before a patch is available could put our clients, their officers, and the people they protect at risk.

### Primary Contact

📧 **security@lemtik.com.ng**

This inbox is monitored by the Lemtik founding team. It is the only channel for responsible disclosure.

### If You Require Encryption

If your report contains sensitive proof-of-concept code, credentials, or personally identifiable information, please indicate this in your initial email and we will provide a secure channel for the full disclosure.

### Backup Contact

If you do not receive an acknowledgement within **48 hours** of emailing `security@lemtik.com.ng`, contact the founder directly:

📧 **amisu@lemtik.com.ng**
📱 **+234 916 765 6667** (WhatsApp available)

---

## 📝 What to Include

A strong report helps us triage and patch faster. Please include as much of the following as possible:

```
[ ] Affected component
    (Dashboard / Relationship API / specific internal service / Supabase schema)

[ ] Type of vulnerability
    (e.g. XSS, IDOR, SQL injection, authentication bypass, RLS policy gap,
     sensitive data exposure, CSRF, privilege escalation, etc.)

[ ] Step-by-step reproduction steps
    Clear enough that our engineering team can reproduce independently

[ ] Proof of concept
    Code snippet, screenshot, or screen recording demonstrating the issue
    — do not access, modify, or exfiltrate real user data during research

[ ] Impact assessment
    What data or functionality is exposed? Which user roles are affected?
    What is the worst-case scenario if this were exploited?

[ ] Suggested fix (optional but appreciated)
    If you have a remediation recommendation, include it

[ ] Your contact details
    Name or handle, email, and preferred response channel
```

The more detail you provide, the faster we can patch and credit you appropriately.

---

## 🔄 What Happens After You Report

| Timeline | What We Do |
|----------|------------|
| **Within 48 hours** | Acknowledge receipt of your report |
| **Within 5 business days** | Initial triage — confirm validity, assign severity rating |
| **Within 14 days** | Provide you with a remediation timeline for valid reports |
| **Upon patch release** | Notify you that the fix is live |
| **After patch + 30 days** | Coordinated public disclosure (if you choose) |

### Severity Ratings

We assess severity using the following scale:

| Severity | Examples | Target Patch Time |
|----------|----------|-------------------|
| 🔴 **Critical** | Auth bypass, RLS policy gap exposing org data across tenants, remote code execution, autonomous control command injection | 24–72 hours |
| 🟠 **High** | Privilege escalation between roles, incident data exposure across organisations, officer location data leak | 7 days |
| 🟡 **Medium** | XSS requiring user interaction, non-sensitive information disclosure, rate limit bypass | 30 days |
| 🟢 **Low** | UI issues with no data impact, minor configuration exposures, informational findings | 90 days |

---

## ✅ Scope

The following are **in scope** for responsible disclosure:

### Web Application
- `app.lemtik.com.ng` — C4I Dashboard (all authenticated surfaces)
- Any authenticated endpoint returning data that should be scoped to a single organisation but is accessible from another
- Any unauthenticated endpoint that exposes sensitive operational data
- JWT implementation weaknesses (token forgery, expiry bypass, algorithm confusion)
- Insecure direct object references (IDOR) — accessing another organisation's incidents, officers, or intelligence data
- Broken access control — lower-privileged roles performing actions reserved for higher roles
- Cross-site scripting (XSS) — especially in the incident description, intelligence feed, or map annotation surfaces where content is rendered from user-submitted data
- Cross-site request forgery (CSRF) — on state-changing operations
- SQL injection or ORM injection via any API endpoint
- File upload vulnerabilities — evidence upload endpoints accepting dangerous file types or paths
- Supabase Row Level Security policy gaps — any policy that allows a client to read or write data belonging to another organisation

### API Layer
- `api.lemtik.com.ng` or Railway-hosted Relationship API
- Internal service key exposure via any external-facing endpoint
- Rate limiting bypass allowing abuse of AI agent calls or incident creation
- Audit log tampering — any path that allows modification or deletion of audit records

### Infrastructure
- Exposed environment variables or secrets in any response body, error message, or log output
- Misconfigured CORS allowing arbitrary origin access to authenticated endpoints
- Supabase anon key being used to perform write operations that should require the service role key

---

## ❌ Out of Scope

The following are **not eligible** for security reports:

```
✗ Social engineering attacks against Lemtik staff or clients
✗ Physical security attacks
✗ Denial of service (DoS/DDoS) attacks — do not test these
✗ Automated scanning results submitted without manual validation
  (scanner output alone is not a valid report)
✗ Issues in third-party services we do not control
  (Supabase, Vercel, Railway, Render, Groq, Twilio, Termii, Resend,
   Mapbox, Radar.io — report these directly to those vendors)
✗ Vulnerabilities requiring physical access to a device
✗ Missing security headers that do not demonstrate a concrete exploit path
✗ Rate limiting on non-sensitive, unauthenticated public endpoints
✗ Self-XSS (only exploitable by the attacker themselves with no user interaction)
✗ CSV injection without demonstrated real-world impact
✗ Any finding on domains or subdomains not listed in the Scope section
✗ Theoretical vulnerabilities without a working proof of concept
✗ Outdated software version reports without demonstrated exploitability
```

---

## 🛡 Security Standards We Follow

| Standard | Application |
|----------|------------|
| **OWASP Top 10** | Application security baseline for all API endpoints and dashboard surfaces |
| **Nigeria Data Protection Act (NDPA) 2023** | Data handling, retention, and breach notification for all user and operational data |
| **JWT Best Practices (RFC 8725)** | RS256 asymmetric signing, short-lived access tokens, httpOnly refresh token storage |
| **Supabase RLS** | Row-level security enforced at the database level for all client data — not just application-level guards |
| **Principle of Least Privilege** | Every service, every user role, and every database connection has only the permissions required for its specific function |
| **Audit Immutability** | Audit log is append-only at the database permission level — no UPDATE or DELETE permitted on audit tables under any circumstances |

---

## 🤝 Our Commitments to Researchers

If you report a valid vulnerability in good faith and follow this policy:

```
✅ We will acknowledge your report within 48 hours
✅ We will keep you informed as we investigate and patch
✅ We will not pursue legal action against you for responsible disclosure
✅ We will credit you in our Hall of Thanks (if you choose)
✅ We will notify you when the vulnerability is patched
✅ We will work with you on coordinated public disclosure timing
```

We ask in return that you:

```
✅ Give us reasonable time to investigate and patch before public disclosure
✅ Do not access, download, or exfiltrate real user or operational data
✅ Do not disrupt live services or production operations
✅ Do not test against accounts belonging to real clients or officers
✅ Limit testing to your own test accounts or our designated sandbox
   if one is made available
```

---

## 🏆 Hall of Thanks

We are grateful to the following researchers who have helped make Lemtik more secure through responsible disclosure:

*No reports have been received yet. Be the first.*

---

<div align="center">

<img src="https://img.shields.io/badge/Security%20Contact-security@lemtik.com.ng-FF6B35?style=for-the-badge&labelColor=080D1A" />

<br/><br/>

**Lemtik Security** · Lagos, Nigeria · [lemtik.com.ng](https://www.lemtik.com.ng)

*This platform protects real people in real situations.*
*We treat every security report with the urgency that deserves.*

</div>
