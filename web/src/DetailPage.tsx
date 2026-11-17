import { Fragment, useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { closeList, useUi, type Portfolio } from './store';

// The “Skip the race” view: the same content as the turn banners, as a page to read. Also the fallback when WebGL is missing.

/** Stagger index for the reveal and hero animations. */
const vi = (i: number) => ({ '--i': i }) as CSSProperties;
const ext = (href: string) => (href.startsWith('http') ? { target: '_blank', rel: 'noreferrer' } : {});
const HERO = ['I build the interface,', 'and everything behind it.'];

export default function DetailPage({ data }: { data: Portfolio }) {
  const open = useUi(s => s.listOpen), note = useUi(s => s.listNote), sec = useUi(s => s.listSec), noGame = useUi(s => s.noGame);
  const list = useRef<HTMLDivElement>(null), hero = useRef<HTMLElement>(null), close = useRef<HTMLButtonElement>(null);
  const st = data.stations, last = st.length - 1;
  const techs = [...new Set(st.flatMap(s => s.chips ?? []))];
  // Smooth or instant is decided in CSS (.list scroll-behavior), which also honours reduced motion.
  const go = (i: number) => list.current?.querySelector('#sec' + i)?.scrollIntoView({ block: 'start' });

  // Scroll-linked effects write classes and CSS variables straight to the DOM. React never re-renders on scroll.
  useEffect(() => {
    const el = list.current;
    if (!open || !el) return;
    const ac = new AbortController(), sig = { signal: ac.signal };
    const secs = [...el.querySelectorAll('.sec')], navEl = el.querySelector<HTMLElement>('.pg-nav')!, nav = [...navEl.querySelectorAll<HTMLElement>('button')];
    const track = el.querySelector('.track')!;
    let shownSec = -2;

    const io = new IntersectionObserver(
      es => es.forEach(en => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } }),
      { root: el, threshold: .12, rootMargin: '0px 0px -6% 0px' });
    el.querySelectorAll('.rv:not(.in)').forEach(n => io.observe(n));

    const sync = () => {
      const ch = el.clientHeight, hmax = el.scrollHeight - ch;
      el.style.setProperty('--pp', (hmax > 0 ? el.scrollTop / hmax : 0).toFixed(4));
      const mid = el.getBoundingClientRect().top + ch * .55, tr = track.getBoundingClientRect();
      el.style.setProperty('--rp', Math.max(0, Math.min(1, (mid - tr.top) / Math.max(1, tr.height))).toFixed(4));
      let cur = -1;
      secs.forEach((s, i) => { if (s.getBoundingClientRect().top < mid) { s.classList.add('on'); cur = i; } });
      nav.forEach((b, i) => b.classList.toggle('on', i === cur));
      // On narrow screens the nav scrolls sideways: keep the current section's button in view.
      if (cur !== shownSec && cur >= 0 && navEl.scrollWidth > navEl.clientWidth)
        navEl.scrollTo({
          left: navEl.scrollLeft + nav[cur].getBoundingClientRect().left - navEl.getBoundingClientRect().left - (navEl.clientWidth - nav[cur].offsetWidth) / 2,
          behavior: shownSec === -2 ? 'instant' : 'smooth',
        });
      shownSec = cur;
    };
    let raf = 0;
    el.addEventListener('scroll', () => { raf ||= requestAnimationFrame(() => { raf = 0; sync(); }); }, { passive: true, ...sig });
    el.addEventListener('pointermove', e => {
      const c = (e.target as Element).closest<HTMLElement>('.pcard'); if (!c) return;
      const r = c.getBoundingClientRect();
      c.style.setProperty('--mx', e.clientX - r.left + 'px'); c.style.setProperty('--my', e.clientY - r.top + 'px');
    }, sig);
    window.addEventListener('keydown', e => { if (e.key === 'Escape' && !noGame) closeList(); }, sig);

    // Every open starts at the top (or the requested section) and replays the hero.
    el.scrollTo({ top: 0, behavior: 'instant' });
    hero.current?.classList.remove('go'); void hero.current?.offsetWidth; hero.current?.classList.add('go');
    if (sec >= 0) secs[sec]?.scrollIntoView({ block: 'start', behavior: 'instant' });
    sync();
    close.current?.focus();
    return () => { ac.abort(); io.disconnect(); cancelAnimationFrame(raf); };
  }, [open, sec, noGame]);

  let wi = 0;
  return (
    <div className="list" ref={list} role="dialog" aria-modal="true" aria-labelledby="listTitle" hidden={!open}>
      <div className="pg-bg" aria-hidden="true"><i /><i /><i /></div>
      <header className="pg-top">
        <div className="pg-brand"><span className="badge" aria-hidden="true">GP</span><strong>{data.name}</strong></div>
        <nav className="pg-nav" aria-label="Sections">
          {st.map((s, i) => <button key={i} type="button" onClick={() => go(i)}><b>T{s.turn}</b>{s.short}</button>)}
        </nav>
        <button className="btn" type="button" ref={close} hidden={noGame} onClick={closeList}>Back to the race</button>
        <div className="pg-prog" aria-hidden="true" />
      </header>

      <main className="pg">
        <section className="hero go" ref={hero}>
          <h1 className="hero-h1" id="listTitle">
            {HERO.map((ln, l) => (
              <span key={l} className={'ln' + (l ? ' ln2' : '')}>
                {ln.split(' ').map((w, k) => <Fragment key={k}><span className="w" style={vi(wi++)}>{w}</span> </Fragment>)}
              </span>
            ))}
          </h1>
          <p className="hero-sub fade">{data.heroSub}</p>
          <div className="cta-row fade">
            <button className="btn primary big" type="button" onClick={() => go(st.findIndex(s => s.projects))}>See my work</button>
            <button className="btn big" type="button" onClick={() => go(last)}>Get in touch</button>
          </div>
          <p className="note">{note}</p>
        </section>
        <div className="marq" aria-hidden="true">
          <div className="marq-in">{[...techs, ...techs].map((t, i) => <span key={i}>{t}</span>)}</div>
        </div>

        <div className="track">
          <div className="rail" aria-hidden="true">
            <div className="rail-fill" />
            <svg className="rail-car" viewBox="0 0 22 38">
              <rect x="4" y="2" width="14" height="3" rx="1" fill="#F4F2FA" /><rect x="8" y="5" width="6" height="27" rx="3" fill="#FF4D8D" />
              <rect x="2" y="9" width="4" height="8" rx="1" fill="#14101F" /><rect x="16" y="9" width="4" height="8" rx="1" fill="#14101F" />
              <rect x="2" y="24" width="4" height="9" rx="1" fill="#14101F" /><rect x="16" y="24" width="4" height="9" rx="1" fill="#14101F" />
              <rect x="1" y="33" width="20" height="3" rx="1" fill="#F4F2FA" />
            </svg>
          </div>
          {st.map((s, i) => (
            <section className="sec" id={'sec' + i} key={i}>
              <span className="sec-dot" aria-hidden="true" />
              <div className="sec-head rv"><span className="tbadge">T{s.turn}</span><h2>{s.title}</h2></div>
              <p className="sec-sub rv" style={vi(1)}>{s.sub}</p>
              <p className={'sec-lead rv' + (i === last ? ' big' : '')} style={vi(2)}>{s.body}</p>
              {s.projects && (
                <div className="pgrid">
                  {s.projects.map((p, j) => (
                    // The wrapper carries the reveal delay so it doesn't slow the card's own hover transition.
                    <div className="rv" style={vi(j + 3)} key={j}>
                      <article className="pcard">
                        <h3>{p.name}</h3>
                        <p>{p.text}</p>
                        <div className="ptags">{p.stack.map(x => <span key={x}>{x}</span>)}</div>
                        {p.url && (
                          <a className="plink" href={p.url} {...ext(p.url)}>View project
                            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 9h12M10 4l5 5-5 5" /></svg>
                          </a>
                        )}
                      </article>
                    </div>
                  ))}
                </div>
              )}
              {s.roles && <ol className="xp">{s.roles.map((r, j) => <li className="rv" style={vi(j + 3)} key={j}><div className="xp-y">{r.years}</div><div><h3>{r.role}</h3><p className="xp-c">{r.company}</p><p>{r.text}</p></div></li>)}</ol>}
              {s.steps && <ol className="psteps">{s.steps.map((x, j) => <li className="rv" style={vi(j + 3)} key={j}><div className="n">{j + 1}</div><h3>{x.title}</h3><p>{x.text}</p></li>)}</ol>}
              {s.chips && <ul className="tags">{s.chips.map((c, j) => <li className="rv" style={vi(j + 3)} key={c}><span>{c}</span></li>)}</ul>}
              {s.links && (
                <div className="cta-row rv" style={vi(4)}>
                  {s.links.map((l, j) => <a key={j} className={'btn big' + (j ? '' : ' primary' + (i === last ? ' pulse' : ''))} href={l.href} {...ext(l.href)}>{l.label}</a>)}
                </div>
              )}
              {i === last && <ContactForm />}
            </section>
          ))}
        </div>
        <footer className="pg-foot"><span>© {new Date().getFullYear()} {data.name}</span><span>Built with React, Three.js and ASP.NET Core</span></footer>
      </main>
    </div>
  );
}

function ContactForm() {
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState('');
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setState('sending');
    try {
      const r = await fetch('/api/contact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(form))) });
      if (!r.ok) throw r.status;
      form.reset(); setState('sent');
    } catch (status) {
      setError(status === 429 ? 'That’s a lot of messages. Please try again in an hour.'
        : status === 400 ? 'Please check the form and try again.'
        : 'That didn’t send. Please try again, or use the email link above.');
      setState('error');
    }
  }
  return (
    <form className="cform rv" style={vi(5)} onSubmit={submit}>
      <h3>Send a message</h3>
      <label>Name<input name="name" required maxLength={80} autoComplete="name" /></label>
      <label>Email<input name="email" type="email" required maxLength={254} autoComplete="email" /></label>
      <label>Message<textarea name="message" required minLength={10} maxLength={4000} /></label>
      {/* Honeypot: people never see or reach this field, bots fill it in. The API drops anything that has it set. */}
      <label className="hp" aria-hidden="true">Website<input name="website" tabIndex={-1} autoComplete="off" /></label>
      <button className="btn primary big" type="submit" disabled={state === 'sending'}>{state === 'sending' ? 'Sending…' : 'Send'}</button>
      <p role="status">{state === 'sent' ? 'Thanks. I’ll get back to you soon.' : state === 'error' ? error : ''}</p>
    </form>
  );
}
