import { useEffect, useRef, type PointerEvent, type RefObject } from 'react';
import { createGame } from './engine';
import { game, openList, set, useUi, type Control, type Portfolio, type Station } from './store';

// This file and engine.ts (with three.js) are one lazy chunk: the intro and the list view never wait for them.

// Canvas textures (signs, dash) are drawn once, so the font has to be there first. Give up waiting after 2 s.
const fonts = Promise.race([document.fonts.load('700 100px "Barlow Condensed"'), new Promise(r => setTimeout(r, 2000))]).catch(() => {});

const ext = (href: string) => (href.startsWith('http') ? { target: '_blank', rel: 'noreferrer' } : {});

export default function Game({ data }: { data: Portfolio }) {
  const host = useRef<HTMLDivElement>(null), map = useRef<HTMLCanvasElement>(null), blur = useRef<HTMLDivElement>(null), vig = useRef<HTMLDivElement>(null);
  const listOpen = useUi(s => s.listOpen);

  useEffect(() => {
    let dead = false;
    fonts.then(() => {
      if (dead) return;
      try {
        game.current = createGame({ host: host.current!, map: map.current!, blur: blur.current!, vig: vig.current! }, data);
        set({ ready: true });
      } catch (err) {
        console.error(err);
        set({ noGame: true });
        openList('The 3D track isn’t available in this browser, so here are all seven turns as a list.');
      }
    });
    return () => { dead = true; game.current?.dispose(); game.current = null; set({ ready: false }); };
  }, [data]);

  return (
    <div ref={host} inert={listOpen}>
      <div className="blur" ref={blur} aria-hidden="true" />
      <div className="vig" ref={vig} aria-hidden="true" />
      <Hud data={data} map={map} />
    </div>
  );
}

function Hud({ data, map }: { data: Portfolio; map: RefObject<HTMLCanvasElement | null> }) {
  const phase = useUi(s => s.phase), cam = useUi(s => s.cam), rain = useUi(s => s.rain), rival = useUi(s => s.rival);
  const shown = useUi(s => s.shown), visited = useUi(s => s.visited), noGame = useUi(s => s.noGame);
  const st = data.stations;
  const hold = (k: Control) => {
    const off = () => { if (game.current) game.current.touch[k] = false; };
    return {
      onPointerDown: (e: PointerEvent<HTMLButtonElement>) => { if (game.current) game.current.touch[k] = true; e.currentTarget.setPointerCapture(e.pointerId); e.preventDefault(); },
      onPointerUp: off, onPointerCancel: off, onLostPointerCapture: off,
      onContextMenu: (e: { preventDefault(): void }) => e.preventDefault(),
    };
  };
  const arrow = (d: string) => <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;

  return (
    <div className={'hud' + (cam === 0 ? ' cockpit' : '')} hidden={noGame} style={{ visibility: phase === 'intro' ? 'hidden' : 'visible' }}>
      <header className="top">
        <div className="panel brand">
          <span className="badge" aria-hidden="true">GP</span>
          <div><strong>{data.name}</strong><span className="role">{data.role}</span></div>
        </div>
        <nav className="panel turns" aria-label="Turns">
          <span className="progress">Turns {visited.length} of {st.length}</span>
          <span style={{ display: 'flex' }}>
            {st.map((x, i) => (
              <button key={i} type="button" className={'pill' + (visited.includes(i) ? ' done' : '') + (i === shown ? ' now' : '')}
                aria-label={`Drive to turn ${x.turn}: ${x.title}`} aria-current={i === shown ? 'true' : undefined} onClick={() => game.current?.teleport(i)}>
                <span>T{x.turn}</span>
              </button>
            ))}
          </span>
          <button className="skip" type="button" onClick={() => openList()}>Skip the race</button>
        </nav>
      </header>

      <Banner stations={st} />

      <div className="bottom">
        <div className="left-stack">
          <Readouts />
          <button className="cam" type="button" onClick={() => game.current?.toggleCam()}>View: {cam ? 'chase' : 'cockpit'}</button>
          <button className="cam" type="button" onClick={() => game.current?.toggleRain()}>Rain: {rain ? 'on' : 'off'}</button>
          <button className="cam" type="button" onClick={() => game.current?.toggleRival()}>Rival: {rival ? 'on' : 'off'}</button>
          <button className="cam" type="button" onClick={() => game.current?.restart()}>Restart</button>
          <div className="panel hint"><kbd>W</kbd> gas &nbsp;<kbd>S</kbd> brake &nbsp;<kbd>A</kbd><kbd>D</kbd> steer &nbsp;<kbd>C</kbd> view &nbsp;<kbd>R</kbd> rain &nbsp;<kbd>O</kbd> rival &nbsp;<kbd>E</kbd> banner</div>
        </div>
        <div className="touch">
          <button className="tbtn" type="button" aria-label="Steer left" {...hold('left')}>{arrow('M14 4l-7 7 7 7')}</button>
          <button className="tbtn" type="button" aria-label="Steer right" {...hold('right')}>{arrow('M8 4l7 7-7 7')}</button>
          <button className="tbtn" type="button" {...hold('brake')}>Brake</button>
          <button className="tbtn gas" type="button" {...hold('gas')}>Gas</button>
        </div>
        <canvas className="panel" id="map" ref={map} role="img" aria-label="Track map. Select a turn to drive there." />
      </div>
    </div>
  );
}

/** Lap, time, best, position and the chase-view speedo. The only part of the HUD that re-renders at 10 Hz. */
function Readouts() {
  const h = useUi(s => s.hud), rival = useUi(s => s.rival);
  return (
    <>
      <div className="panel racebox" aria-label="Race status">
        <div className="lapn"><span>Lap</span><b>{h.lap}</b></div>
        <div><span>Time</span><b>{h.time}</b></div>
        <div><span>Best</span><b>{h.best}</b></div>
        {rival && <div><span>Position</span><b>{h.pos}</b><em>{h.gap}</em></div>}
      </div>
      <div className="panel speedo" aria-hidden="true">
        <div className="speed">{h.kmh}</div>
        <div className="speed-meta"><span>km/h</span><b>{h.gear}</b><span>{h.drive}</span></div>
      </div>
    </>
  );
}

/** Slides down by itself when the car enters a turn and stays until the next one. Never needs a click. */
function Banner({ stations }: { stations: Station[] }) {
  const shown = useUi(s => s.shown), hidden = useUi(s => s.bannerHidden);
  const keep = useRef(0);   // keep the last station's content in place while the banner slides away
  if (shown >= 0) keep.current = shown;
  const i = keep.current, st = stations[i], last = stations.length - 1, nxt = stations[(i + 1) % stations.length];
  const show = shown >= 0 && !hidden;
  return (
    <aside className={'panel tb' + (show ? ' show' : '')} aria-live="polite" aria-label="Turn details" aria-hidden={!show} inert={!show}>
      <button className="x" type="button" aria-label="Hide turn banner" onClick={() => set({ bannerHidden: true })}>
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 4l10 10M14 4L4 14" /></svg>
      </button>
      <div className="tb-body swap" key={i}>
        <div className="tb-id"><span className="tbadge">T{st.turn}</span><div><h2>{st.title}</h2><p className="sub">{st.sub}</p></div></div>
        <div className="tb-main">
          <p className="lead">{st.body}</p>
          {st.chips && <ul className="chips">{st.chips.map(c => <li key={c}>{c}</li>)}</ul>}
          {st.roles && <ul className="tcols c3">{st.roles.map((r, j) => <li key={j}><strong>{r.role}</strong><em>{r.company} · {r.years}</em><span>{r.text}</span></li>)}</ul>}
          {st.projects && <ul className="tcols c3">{st.projects.map((p, j) => <li key={j}><strong>{p.name}</strong><span>{p.text}</span><em>{p.stack.join(' · ')}</em></li>)}</ul>}
          {st.steps && <ol className="tcols c4">{st.steps.map((x, j) => <li key={j}><b>{j + 1}</b><strong>{x.title}</strong><span>{x.text}</span></li>)}</ol>}
          {(st.links || i === last) && (
            <div className="links">
              {st.links?.map((l, j) => <a key={j} className={'btn' + (j ? '' : ' primary')} href={l.href} {...ext(l.href)}>{l.label}</a>)}
              {i === last && <button className="btn" type="button" onClick={() => openList('', last)}>Send a message</button>}
            </div>
          )}
        </div>
        <div className="tb-next">{i < last ? `Next: T${nxt.turn} ${nxt.short}` : 'Lap complete'}</div>
      </div>
    </aside>
  );
}
