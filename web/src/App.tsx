import { lazy, Suspense, useEffect, useRef, useState, type ComponentType } from 'react';
import DetailPage from './DetailPage';
import { game, openList, reduceMotion, set, useUi, type Portfolio } from './store';

/** Stands in for the game when its chunk fails to download: straight to the list view. */
function NoGame(_: { data: Portfolio }) {
  useEffect(() => {
    set({ noGame: true });
    openList('The 3D track couldn’t load, so here are all seven turns as a list.');
  }, []);
  return null;
}
const Game = lazy<ComponentType<{ data: Portfolio }>>(() => import('./Game').catch(() => ({ default: NoGame })));

export default function App() {
  const [data, setData] = useState<Portfolio | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    fetch('/api/portfolio')
      .then(r => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: Portfolio) => { document.title = `${d.name} – Portfolio Grand Prix`; setData(d); })
      .catch(() => setFailed(true));
  }, []);

  if (!data) return <p className="boot" role="status">{failed ? 'Couldn’t load the portfolio. Refresh to try again.' : 'Loading…'}</p>;
  return (
    <>
      <Suspense fallback={null}><Game data={data} /></Suspense>
      <Intro />
      <Lights />
      <Toast />
      <DetailPage data={data} />
    </>
  );
}

function Intro() {
  const phase = useUi(s => s.phase), ready = useUi(s => s.ready), night = useUi(s => s.night), rain = useUi(s => s.rain);
  const noGame = useUi(s => s.noGame), listOpen = useUi(s => s.listOpen);
  const startBtn = useRef<HTMLButtonElement>(null), seen = useRef(false);
  // After a restart, put focus back on Start engine (but don't steal it on first load).
  useEffect(() => { if (phase === 'intro' && seen.current) startBtn.current?.focus(); seen.current = true; }, [phase]);

  return (
    <div className="intro" hidden={phase !== 'intro' || noGame} inert={listOpen}>
      <div className="panel intro-card" role="dialog" aria-labelledby="introTitle">
        <h1 id="introTitle">Take a lap through my work.</h1>
        <p>A street circuit with a rival on your tail. Each of the seven turns is a part of my portfolio: who I am, where I’ve worked, my frontend and backend skills, projects, how I work, and how to reach me.</p>
        <div className="row">
          <button className="btn primary" type="button" ref={startBtn} disabled={!ready} onClick={() => game.current?.start()}>{ready ? 'Start engine' : 'Loading track…'}</button>
          <button className="btn" type="button" onClick={() => openList()}>Skip to the list</button>
        </div>
        <div className="keys">
          <div><kbd>W</kbd> or <kbd>↑</kbd> hold for gas</div>
          <div><kbd>S</kbd> or <kbd>↓</kbd> brake</div>
          <div><kbd>A</kbd> <kbd>D</kbd> or <kbd>←</kbd> <kbd>→</kbd> steer</div>
          <div><kbd>C</kbd> cockpit or chase view</div>
          <div><kbd>R</kbd> rain on or off</div>
          <div><kbd>O</kbd> rival on or off</div>
          <div><kbd>E</kbd> hide or show the turn banner</div>
        </div>
        <p className="keys-touch">Hold <b>Gas</b> to drive and <b>Brake</b> to slow down, and steer with the arrows on the left. Tap a turn number at the top to jump straight to it.</p>
        <p className="note">{ready && (night ? (rain ? 'Race conditions: night, rain, wet track.' : 'Race conditions: night, dry track.') : 'Race conditions: sunny day, dry track.')}</p>
        <p className="note">{reduceMotion
          ? 'Reduced motion is on, so rain starts off. The list view shows everything without the driving.'
          : 'The car only moves while you hold gas. Let go and it coasts to a stop. At every turn the details appear in a banner across the top.'}</p>
      </div>
    </div>
  );
}

function Lights() {
  const n = useUi(s => s.lights);
  return <div className="lights" hidden={n < 0} aria-hidden="true">{[0, 1, 2, 3, 4].map(i => <i key={i} className={i < n ? 'on' : undefined} />)}</div>;
}

function Toast() {
  const msg = useUi(s => s.toast), on = useUi(s => s.toastOn);
  return <div className={'toast' + (on ? ' show' : '')} role="status">{msg}</div>;
}
