import React, { useEffect, useState } from 'react';

const LINKS = {
  github: 'https://github.com/alexlee9899',
  linkedin: 'https://www.linkedin.com/in/alex-yanlin-li/',
  email: 'lyanlin99@gmail.com',
};

const BIO =
  'Alex Lee is a full-stack & AI software developer with a strong foundation across both frontend and backend. ' +
  'He builds visually polished, high-performance products end to end — from real-time systems and CRMs to AI voice agents — ' +
  'and holds a Master of Information Technology (Distinction) from UNSW. He thrives on turning messy problems into clean, shippable software.';

const SKILLS = [
  'React 18/19', 'Next.js 15', 'TypeScript', 'Node.js / Express', 'Nest.js', 'FastAPI / Flask',
  'PostgreSQL / Prisma', 'MongoDB', 'Redis', 'Tailwind CSS', 'Docker / CI-CD',
  'AWS (EC2/S3)', 'Socket.IO / TCP', 'Google Maps API', 'OpenAI / RAG / Vision', 'Jest / Vitest',
];

const EXPERIENCE = [
  {
    role: 'AI Software Developer', company: 'Duo Tax, Sydney', period: 'Aug 2025 – Present',
    points: [
      'Built “Caesar,” an enterprise Salesforce CRM used daily by 220+ staff, cutting handling time ~60%.',
      'Engineered RBAC, Redis caching with distributed locks, and Celery workers for high-concurrency workloads.',
      'Shipped AI features: fine-tuned GPT-4o classification, a RAG knowledge base, and Vision OCR.',
    ],
  },
  {
    role: 'Full-Stack Developer', company: 'Pospal Australia, Sydney', period: 'Feb 2025 – Jul 2025',
    points: [
      'Built a real-time Kitchen Display System (React Native) with custom TCP + Socket.IO sub-second sync.',
      'Wrote Android native modules (Java) and a thermal-printer driver; deployed scalable Node services.',
    ],
  },
  {
    role: 'Full-Stack Developer', company: 'Jobpin AI, Sydney', period: 'Nov 2024 – Feb 2025',
    points: [
      'Built a subscription pricing system in Nest.js + MongoDB with dynamic plan CRUD.',
      'Containerized the stack with Docker and automated build/test/deploy via CI/CD.',
    ],
  },
];

const EDUCATION = [
  { degree: 'Master of Information Technology (Distinction)', school: 'University of New South Wales', period: '2021 – 2023' },
  { degree: 'Bachelor of Information Technology', school: 'Henan Institute of Science and Technology', period: '2016 – 2020' },
];

const PROJECTS = [
  {
    title: 'Ball Radar', featured: true,
    desc: 'This very app — a full-stack platform for discovering and sharing Sydney basketball courts: live Google Maps with Places search, ratings/reviews/photos, follows & leaderboard, guest mode, an admin panel, and a TypeScript API on PostgreSQL.',
    tags: ['React', 'TypeScript', 'Node/Express', 'PostgreSQL', 'Google Maps', 'Docker'],
    live: '/', git: 'https://github.com/alexlee9899/Ball-Radar',
  },
  {
    title: 'KDS Real-time System',
    desc: 'High-performance Kitchen Display System for commercial kitchens, with sub-second order sync over custom TCP and Socket.IO.',
    tags: ['Real-time', 'React Native', 'Node.js', 'Socket.IO'],
    git: 'https://github.com/alexlee9899/KDS', live: '',
  },
  {
    title: 'Achoio',
    desc: 'Collaboration platform for speech-synthesis researchers to manage voice projects, rate audio, and feed high-quality feedback into AI model tuning.',
    tags: ['Machine Learning', 'React', 'FastAPI', 'shadcn/ui'],
    git: '', live: 'https://www.achoio.com/',
  },
  {
    title: 'VTGMAMA E-commerce',
    desc: 'Scalable e-commerce platform built from scratch: product listing, checkout, admin dashboard, and auth.',
    tags: ['Next.js 15', 'FastAPI', 'MongoDB'],
    git: 'https://github.com/haoweilou/OnlineShop', live: 'https://vtgmama.vercel.app/',
  },
  {
    title: 'Game-Hub',
    desc: 'Game discovery platform with search, filtering, and sorting, integrated with the RAWG game API.',
    tags: ['React', 'TypeScript', 'Chakra UI'],
    git: 'https://github.com/alexlee9899/game-hub-Third-Party-API-', live: 'https://game-hub-phi-liard.vercel.app/',
  },
  {
    title: 'Jobpin AI Subscription',
    desc: 'Subscription pricing & billing system with a responsive plan-management UI and a Dockerized, CI/CD-deployed backend.',
    tags: ['Nest.js', 'MongoDB', 'Docker', 'CI/CD'],
    git: '', live: '',
  },
  {
    title: 'Personal Website',
    desc: 'Responsive personal portfolio with dark theme, dynamic content, and a contact form.',
    tags: ['Next.js', 'Tailwind CSS', 'Resend'],
    git: 'https://github.com/alexlee9899/AlexLee---PersonalWeb', live: 'https://alexlee-web.vercel.app/',
  },
];

export default function About() {
  const [tab, setTab] = useState('skills');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', localStorage.getItem('ballradar_theme') || 'day');
  }, []);

  return (
    <div className="about">
      <header className="about-top">
        <a className="brand" href="/">
          <span className="brand__mark">◎</span>
          <div><h1>Ball Radar</h1><p>about the developer</p></div>
        </a>
        <div className="spacer" />
        <a className="btn btn--ghost btn--sm" href="/">← Back to map</a>
      </header>

      <main className="about-body">
        {/* Hero */}
        <section className="about-hero">
          <div className="about-avatar">AL</div>
          <div>
            <h2 className="neon-title about-name">Alex (Yanlin) Li</h2>
            <p className="about-role">Full-Stack &amp; AI Software Developer · Sydney</p>
            <p className="about-bio">{BIO}</p>
            <div className="about-links">
              <a className="btn btn--primary btn--sm" href={LINKS.github} target="_blank" rel="noreferrer">GitHub</a>
              <a className="btn btn--ghost btn--sm" href={LINKS.linkedin} target="_blank" rel="noreferrer">LinkedIn</a>
              <a className="btn btn--ghost btn--sm" href={`mailto:${LINKS.email}`}>Email</a>
            </div>
          </div>
        </section>

        {/* Tabs: skills / experience / education */}
        <section className="about-card">
          <div className="about-tabs">
            {['skills', 'experience', 'education'].map((t) => (
              <button key={t} className={'about-tab ' + (tab === t ? 'on' : '')} onClick={() => setTab(t)}>
                {t[0].toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>

          {tab === 'skills' && (
            <div className="skill-grid">
              {SKILLS.map((s) => <span key={s} className="chip">{s}</span>)}
            </div>
          )}

          {tab === 'experience' && (
            <div className="exp-list">
              {EXPERIENCE.map((e) => (
                <div className="exp-card" key={e.company}>
                  <div className="exp-head"><b>{e.role}</b><span className="muted">{e.period}</span></div>
                  <div className="exp-company">{e.company}</div>
                  <ul>{e.points.map((p, i) => <li key={i}>{p}</li>)}</ul>
                </div>
              ))}
            </div>
          )}

          {tab === 'education' && (
            <div className="exp-list">
              {EDUCATION.map((e) => (
                <div className="exp-card" key={e.school}>
                  <div className="exp-head"><b>{e.degree}</b><span className="muted">{e.period}</span></div>
                  <div className="exp-company">{e.school}</div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Projects */}
        <h3 className="about-section-title">Projects</h3>
        <section className="proj-grid">
          {PROJECTS.map((p) => (
            <div key={p.title} className={'proj-card' + (p.featured ? ' is-featured' : '')}>
              {p.featured && <span className="proj-badge">This app</span>}
              <h4>{p.title}</h4>
              <p>{p.desc}</p>
              <div className="proj-tags">{p.tags.map((t) => <span key={t} className="chip">{t}</span>)}</div>
              <div className="proj-links">
                {p.live && <a className="btn btn--primary btn--sm" href={p.live} target={p.live.startsWith('http') ? '_blank' : undefined} rel="noreferrer">Live</a>}
                {p.git && <a className="btn btn--ghost btn--sm" href={p.git} target="_blank" rel="noreferrer">Code</a>}
              </div>
            </div>
          ))}
        </section>
      </main>

      <footer className="about-foot">
        <span className="muted">Built by Alex Lee · </span>
        <a className="userlink" href="/">Ball Radar</a>
      </footer>
    </div>
  );
}
