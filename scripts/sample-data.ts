// Shared sample data for preview-gen + showcase-gen.
// Each key maps a template id -> the Mustache data used to fill its tokens.
export const SAMPLE_DATA: Record<string, Record<string, unknown>> = {
  title: {
    title: "Welcome to the Platform",
    subtitle: "A modern foundation for your presentations",
  },
  "bullet-list": {
    title: "Key Highlights",
    items: [
      { text: "Fully customisable slide templates" },
      { text: "Mustache-powered token substitution" },
      { text: "Landscape and portrait orientations" },
      { text: "Automated preview generation" },
    ],
  },
  "two-column": {
    title: "Side by Side Comparison",
    leftContent:
      "<h3>Approach A</h3><p>Simple, battle-tested methodology that scales well for small teams and iterative projects.</p><ul><li>Low overhead</li><li>Fast iteration</li></ul>",
    rightContent:
      "<h3>Approach B</h3><p>Structured framework designed for large organisations with complex delivery pipelines.</p><ul><li>Strong governance</li><li>Audit trail</li></ul>",
  },
  "img-text": {
    imageUrl:
      "https://images.unsplash.com/photo-1551650975-87deedd944c3?w=800&auto=format&fit=crop",
    imageAlt: "Developer working on a laptop",
    title: "Built for developers",
    body: "<p>Our template engine integrates seamlessly with your existing workflow. Write HTML once, render everywhere.</p><ul><li>Mustache tokens</li><li>Scoped CSS</li><li>Playwright previews</li></ul>",
  },
  quote: {
    quote:
      "Any sufficiently advanced technology is indistinguishable from magic.",
    author: "Arthur C. Clarke",
    source: "Profiles of the Future, 1962",
  },
  "code-block": {
    title: "Rendering a Template",
    language: "typescript",
    code: `import Mustache from 'mustache';\nimport * as fs from 'fs';\n\nconst template = fs.readFileSync('landscape.html', 'utf8');\nconst output = Mustache.render(template, {\n  title: 'Hello, World!',\n  subtitle: 'My first slide',\n});\n\nconsole.log(output);`,
  },
  image: {
    imageUrl:
      "https://images.unsplash.com/photo-1551650975-87deedd944c3?w=800&auto=format&fit=crop",
    description: "A developer working on the next generation of slide templates",
  },
  table: {
    title: "Q1 Performance",
    headers: [
      { label: "Metric" },
      { label: "Target" },
      { label: "Actual" },
      { label: "Status" },
    ],
    rows: [
      { cells: [{ value: "Revenue" }, { value: "$1.2M" }, { value: "$1.35M" }, { value: "On track" }] },
      { cells: [{ value: "Users" }, { value: "5,000" }, { value: "4,820" }, { value: "Near target" }] },
      { cells: [{ value: "NPS" }, { value: "42" }, { value: "47" }, { value: "Exceeded" }] },
      { cells: [{ value: "Uptime" }, { value: "99.9%" }, { value: "99.97%" }, { value: "Exceeded" }] },
    ],
  },
  chart: {
    title: "Monthly Active Users",
    chartType: "bar",
    data: JSON.stringify({
      labels: ["Jan", "Feb", "Mar", "Apr", "May", "Jun"],
      datasets: [{ label: "MAU", data: [1200, 1900, 2400, 2200, 2800, 3100] }],
    }),
  },
  kpi: {
    eyebrow: "Snapshot",
    title: "Cohort 23 · By the numbers",
    items: [
      { label: "Fellows", value: "248", delta: "▲ 32 vs 22", brand: true },
      { label: "Companies", value: "17", delta: "▲ 5 new" },
      { label: "Lessons", value: "94" },
      { label: "Avg NPS", value: "9.2", delta: "▲ +0.4" },
      { label: "Completion", value: "87%", delta: "▲ +6 pp" },
      { label: "Repos shipped", value: "1.4k" },
    ],
  },
  "section-header": {
    chapterNo: "03",
    eyebrow: "Module · Backend foundations",
    title: "Designing for failure",
    description:
      "Distributed systems fail. This chapter walks through the patterns we use at scale — circuit breakers, retries, idempotency keys.",
  },
  steps: {
    eyebrow: "Process",
    title: "Record & publish flow",
    items: [
      { num: "01", title: "Plan", body: "Outline the lesson in our editor with AI assistance.", state: "done" },
      { num: "02", title: "Record", body: "Screen + webcam capture, multi-take support.", state: "active" },
      { num: "03", title: "Edit", body: "Auto-cut silences, generate captions, B-roll." },
      { num: "04", title: "Publish", body: "Ship to fellows + companies with one click." },
    ],
  },
  callout: {
    icon: "!",
    eyebrow: "Key takeaway",
    title: "Templates are CSS, not magic.",
    body: "Every Lesson Studio template ships as a single HTML/CSS file with a documented data contract. Swap themes by swapping one stylesheet.",
  },
  "image-row": {
    eyebrow: "Claude Code 101",
    title: "Three pillars of agentic coding",
    images: [
      {
        url: "https://images.unsplash.com/photo-1551650975-87deedd944c3?w=800&auto=format&fit=crop",
        alt: "Developer working on a laptop",
        credit: "Unsplash · Charles Deluvio",
      },
      {
        url: "https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=800&auto=format&fit=crop",
        alt: "Code on a screen",
      },
      {
        url: "https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=800&auto=format&fit=crop",
        alt: "Terminal and editor side by side",
        credit: "Unsplash · Markus Spiske",
      },
    ],
  },
  "big-statement": {
    statement:
      "AI won't replace developers — developers using AI will replace those who don't.",
    eyebrow: "The thesis",
  },
  "full-bleed": {
    imageUrl:
      "https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1600&auto=format&fit=crop",
    imageAlt: "A glowing network of connected nodes",
    title: "The Network Era",
    eyebrow: "Module 3",
  },
  "big-image": {
    imageUrl:
      "https://images.unsplash.com/photo-1517180102446-f3ece451e9d8?w=1400&auto=format&fit=crop",
    imageAlt: "A laptop showing a terminal interface",
    title: "The Claude Code terminal UI",
    caption: "Agentic coding in your terminal",
  },
  "image-grid": {
    title: "What you'll build",
    images: [
      {
        url: "https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=800&auto=format&fit=crop",
        alt: "Code on a screen",
      },
      {
        url: "https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=800&auto=format&fit=crop",
        alt: "Terminal and editor side by side",
      },
      {
        url: "https://images.unsplash.com/photo-1498050108023-c5249f4df085?w=800&auto=format&fit=crop",
        alt: "Developer workstation with code",
      },
      {
        url: "https://images.unsplash.com/photo-1461749280684-dccba630e2f6?w=800&auto=format&fit=crop",
        alt: "Software code on a monitor",
      },
    ],
  },
  comparison: {
    title: "Manual vs Agentic",
    leftLabel: "Before",
    rightLabel: "After",
    leftItems: [
      { text: "Copy-paste from docs by hand" },
      { text: "Context lives only in your head" },
      { text: "Repetitive boilerplate every time" },
    ],
    rightItems: [
      { text: "Agent reads the docs for you" },
      { text: "Context persists across sessions" },
      { text: "Boilerplate generated on demand" },
    ],
  },
  "stat-number": {
    value: "73%",
    label: "of developers now use AI tools daily",
    eyebrow: "Stack Overflow 2025",
    source: "n=90,000 respondents",
  },
  "feature-cards": {
    eyebrow: "Claude Code 101",
    title: "Three pillars",
    cards: [
      {
        iconUrl:
          "https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=400&auto=format&fit=crop",
        title: "Read",
        caption: "Understands your whole codebase",
      },
      {
        iconUrl:
          "https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=400&auto=format&fit=crop",
        title: "Plan",
        caption: "Breaks work into clear steps",
      },
      {
        iconUrl:
          "https://images.unsplash.com/photo-1498050108023-c5249f4df085?w=400&auto=format&fit=crop",
        title: "Ship",
        caption: "Writes, tests, and opens the PR",
      },
    ],
  },
  "image-quote": {
    imageUrl:
      "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=800&auto=format&fit=crop",
    imageAlt: "Portrait of a person",
    quote: "The best way to predict the future is to invent it.",
    author: "Alan Kay",
    role: "Computer scientist",
  },
  "title-image": {
    eyebrow: "DevFellowship",
    title: "Claude Code 101",
    subtitle: "From zero to agentic coding",
    imageUrl:
      "https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1000&auto=format&fit=crop",
    imageAlt: "A terminal and code editor side by side",
  },
  "screenshot-frame": {
    imageUrl:
      "https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=1400&auto=format&fit=crop",
    imageAlt: "A dashboard interface",
    urlBar: "app.devfellowship.com",
    title: "The new dashboard, end to end",
  },
  "annotated-image":   {
      "imageUrl": "https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=1200&auto=format&fit=crop",
      "imageAlt": "A dashboard interface with analytics charts",
      "title": "Key areas to note",
      "pins": [
          {
              "number": "1",
              "label": "Conversion funnel entry",
              "x": "22",
              "y": "35"
          },
          {
              "number": "2",
              "label": "Drop-off spike",
              "x": "55",
              "y": "60"
          },
          {
              "number": "3",
              "label": "Re-engagement zone",
              "x": "78",
              "y": "25"
          }
      ]
  },
  "image-caption-grid":   {
      "title": "Our stack in action",
      "images": [
          {
              "url": "https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=800&auto=format&fit=crop",
              "alt": "Code on screen",
              "caption": "Write less, ship more"
          },
          {
              "url": "https://images.unsplash.com/photo-1498050108023-c5249f4df085?w=800&auto=format&fit=crop",
              "alt": "Developer workstation",
              "caption": "Built for real workflows"
          },
          {
              "url": "https://images.unsplash.com/photo-1461749280684-dccba630e2f6?w=800&auto=format&fit=crop",
              "alt": "Software code on monitor",
              "caption": "Readable at every scale"
          },
          {
              "url": "https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&auto=format&fit=crop",
              "alt": "Dashboard analytics",
              "caption": "Data you can act on"
          }
      ]
  },
  "before-after-image":   {
      "title": "The redesign",
      "beforeUrl": "https://images.unsplash.com/photo-1461749280684-dccba630e2f6?w=1200&auto=format&fit=crop",
      "beforeAlt": "Old interface with cluttered layout",
      "beforeLabel": "Before",
      "afterUrl": "https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=1200&auto=format&fit=crop",
      "afterAlt": "New clean dashboard interface",
      "afterLabel": "After"
  },
  "polaroid-stack":   {
      "title": "Moments from the sprint",
      "photos": [
          {
              "url": "https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=800&auto=format&fit=crop",
              "alt": "Team working together",
              "caption": "kickoff day"
          },
          {
              "url": "https://images.unsplash.com/photo-1498050108023-c5249f4df085?w=800&auto=format&fit=crop",
              "alt": "Laptop with code",
              "caption": "deep work"
          },
          {
              "url": "https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=800&auto=format&fit=crop",
              "alt": "Code on bright screen",
              "caption": "shipped it"
          }
      ]
  },
  "logo-wall":   {
      "title": "Tools we use",
      "eyebrow": "Our stack",
      "logos": [
          {
              "url": "https://images.unsplash.com/photo-1518770660439-4636190af475?w=200&auto=format&fit=crop",
              "alt": "TypeScript",
              "name": "TypeScript"
          },
          {
              "url": "https://images.unsplash.com/photo-1461749280684-dccba630e2f6?w=200&auto=format&fit=crop",
              "alt": "React",
              "name": "React"
          },
          {
              "url": "https://images.unsplash.com/photo-1498050108023-c5249f4df085?w=200&auto=format&fit=crop",
              "alt": "Node.js",
              "name": "Node.js"
          },
          {
              "url": "https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=200&auto=format&fit=crop",
              "alt": "Supabase",
              "name": "Supabase"
          },
          {
              "url": "https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=200&auto=format&fit=crop",
              "alt": "Grafana",
              "name": "Grafana"
          },
          {
              "url": "https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=200&auto=format&fit=crop",
              "alt": "Docker",
              "name": "Docker"
          }
      ]
  },
  "video":   {
      "posterUrl": "https://images.unsplash.com/photo-1461749280684-dccba630e2f6?w=1200&auto=format&fit=crop",
      "posterAlt": "Developer working at a workstation",
      "title": "Building with Claude Code — Live Demo",
      "caption": "12 min"
  },
  "split-media":   {
      "title": "Mobile vs Desktop Experience",
      "leftUrl": "https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=1200&auto=format&fit=crop",
      "leftAlt": "Dashboard on desktop browser",
      "leftLabel": "Desktop",
      "rightUrl": "https://images.unsplash.com/photo-1498050108023-c5249f4df085?w=1200&auto=format&fit=crop",
      "rightAlt": "Dashboard on mobile device",
      "rightLabel": "Mobile"
  },
  "code-output":   {
      "title": "Running the deploy script",
      "code": "git add .\ngit commit -m \"feat: add auth\"\ngit push origin main",
      "language": "bash",
      "output": "[main 3f8a2c1] feat: add auth\n 3 files changed, 42 insertions(+)\nBranch 'main' set up to track remote.\nTo github.com:devfellowship/app.git\n   a1b2c3d..3f8a2c1  main -> main"
  },
  "definition":   {
      "term": "Agentic Loop",
      "eyebrow": "noun · AI/ML",
      "definition": "A cycle in which an AI model plans, executes, observes the result, and iterates — without human intervention between steps."
  },
  "matrix-2x2":   {
      "title": "Effort vs. Impact",
      "xAxisLabel": "Effort →",
      "yAxisLabel": "Impact →",
      "quadrants": [
          {
              "label": "Quick Wins",
              "note": "High impact, low effort"
          },
          {
              "label": "Major Projects",
              "note": "High impact, high effort"
          },
          {
              "label": "Fill-ins",
              "note": "Low impact, low effort"
          },
          {
              "label": "Thankless Tasks",
              "note": "Low impact, high effort"
          }
      ]
  },
  "timeline":   {
      "title": "Product Milestones",
      "milestones": [
          {
              "date": "Q1 2024",
              "label": "Alpha launch",
              "note": "Internal beta with 50 fellows"
          },
          {
              "date": "Q2 2024",
              "label": "Partner onboarding",
              "note": "First 3 companies integrated"
          },
          {
              "date": "Q3 2024",
              "label": "Public beta",
              "note": "Open access, 1,000 users"
          },
          {
              "date": "Q4 2024",
              "label": "v1.0 release",
              "note": "Full feature parity"
          }
      ]
  },
  "process-flow":   {
      "title": "Onboarding Flow",
      "steps": [
          {
              "label": "Sign up",
              "note": "Email + password"
          },
          {
              "label": "Profile setup",
              "note": "Role, skills, goals"
          },
          {
              "label": "Course match",
              "note": "AI recommendation"
          },
          {
              "label": "First lesson",
              "note": "Watch & complete"
          }
      ]
  },
  "hierarchy-tree":   {
      "title": "Team Structure",
      "root": "CTO",
      "children": [
          {
              "label": "Frontend",
              "note": "3 engineers"
          },
          {
              "label": "Backend",
              "note": "4 engineers"
          },
          {
              "label": "Design",
              "note": "2 designers"
          },
          {
              "label": "DevOps",
              "note": "1 engineer"
          }
      ]
  },
  "agenda":   {
      "title": "Today's Agenda",
      "eyebrow": "Module 2",
      "items": [
          {
              "label": "Intro & context",
              "note": "5 min"
          },
          {
              "label": "Core concept walkthrough",
              "note": "15 min"
          },
          {
              "label": "Live demo",
              "note": "10 min"
          },
          {
              "label": "Q&A",
              "note": "10 min"
          }
      ]
  },
  "checklist":   {
      "title": "Launch Checklist",
      "items": [
          {
              "text": "CI pipeline passing",
              "done": true
          },
          {
              "text": "Staging deploy verified",
              "done": true
          },
          {
              "text": "Feature flags enabled",
              "done": true
          },
          {
              "text": "Rollback plan documented",
              "done": false
          },
          {
              "text": "On-call notified",
              "done": false
          }
      ]
  },
  "pros-cons":   {
      "title": "Should we migrate to a monorepo?",
      "pros": [
          {
              "text": "Unified dependency management across all services"
          },
          {
              "text": "Easier cross-package refactoring and code sharing"
          },
          {
              "text": "Single CI pipeline reduces configuration overhead"
          },
          {
              "text": "Atomic commits spanning multiple packages"
          }
      ],
      "cons": [
          {
              "text": "Initial migration effort is significant"
          },
          {
              "text": "Build times increase without granular caching"
          },
          {
              "text": "Requires tooling discipline (Turborepo / Nx)"
          },
          {
              "text": "Harder to enforce team boundaries"
          }
      ]
  },
  "roadmap":   {
      "title": "Product Roadmap",
      "phases": [
          {
              "label": "Now",
              "bullets": [
                  {
                      "text": "Ship onboarding v2"
                  },
                  {
                      "text": "Fix auth edge cases"
                  },
                  {
                      "text": "Mobile responsive pass"
                  }
              ]
          },
          {
              "label": "Next",
              "bullets": [
                  {
                      "text": "Payments integration"
                  },
                  {
                      "text": "Team workspaces"
                  },
                  {
                      "text": "Advanced analytics"
                  }
              ]
          },
          {
              "label": "Later",
              "bullets": [
                  {
                      "text": "Native mobile apps"
                  },
                  {
                      "text": "API v2 public beta"
                  },
                  {
                      "text": "White-label offering"
                  }
              ]
          }
      ]
  },
  "cycle":   {
      "title": "The Continuous Improvement Loop",
      "stages": [
          {
              "label": "Plan",
              "note": "Define goals and scope"
          },
          {
              "label": "Build",
              "note": "Develop and integrate"
          },
          {
              "label": "Ship",
              "note": "Deploy to production"
          },
          {
              "label": "Learn",
              "note": "Measure and analyse"
          }
      ]
  },
  "chapter-image":   {
      "chapterNumber": "03",
      "title": "Building for Scale",
      "subtitle": "Architecture decisions that compound",
      "imageUrl": "https://images.unsplash.com/photo-1461749280684-dccba630e2f6?w=1200&auto=format&fit=crop",
      "imageAlt": "A developer workstation with multiple monitors"
  },
  "stat-grid":   {
      "title": "Q2 Metrics at a Glance",
      "stats": [
          {
              "value": "1,248",
              "label": "Active Fellows",
              "caption": "+18% vs last quarter"
          },
          {
              "value": "94%",
              "label": "Completion Rate",
              "caption": "Avg across all cohorts"
          },
          {
              "value": "9.4",
              "label": "Avg NPS Score",
              "caption": "Target: 9.0"
          },
          {
              "value": "38",
              "label": "Partner Companies",
              "caption": "5 new this quarter"
          }
      ]
  },
};
