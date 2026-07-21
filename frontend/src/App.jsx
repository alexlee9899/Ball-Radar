import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Loader } from '@googlemaps/js-api-loader';
import { MarkerClusterer } from '@googlemaps/markerclusterer';
import confetti from 'canvas-confetti';
import { api, assetUrl, getUser, getToken, setSession, clearSession, getGuestName, setGuestName } from './api.js';

// Celebratory burst in the brand colors (used on guest/user contributions).
function boom() {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  confetti({ particleCount: 90, spread: 70, origin: { y: 0.7 }, colors: ['#E1571F', '#F2894A', '#C24A18', '#2C7A72'] });
}

const reduceMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// Animate an integer from 0 → value with an ease-out curve.
function useCountUp(target, ms = 750) {
  const [n, setN] = useState(reduceMotion() ? target : 0);
  useEffect(() => {
    if (reduceMotion()) { setN(target); return; }
    let raf; const start = performance.now();
    const tick = (t) => {
      const p = Math.min(1, (t - start) / ms);
      setN(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return n;
}
function CountUp({ value }) { return <>{useCountUp(value)}</>; }

// Brand mark — the CSS basketball from the design, redrawn as an SVG:
// radial-lit sphere with four seams (vertical, horizontal, two outward-bowing arcs).
function BallMark({ size = 36 }) {
  return (
    <svg className="ballmark" width={size} height={size} viewBox="0 0 36 36" aria-hidden="true">
      <defs>
        <radialGradient id="brBall" cx="34%" cy="28%" r="82%">
          <stop offset="0%" stopColor="#F2894A" />
          <stop offset="56%" stopColor="#E1571F" />
          <stop offset="100%" stopColor="#C4481A" />
        </radialGradient>
        <clipPath id="brBallClip"><circle cx="18" cy="18" r="18" /></clipPath>
      </defs>
      <g clipPath="url(#brBallClip)">
        <circle cx="18" cy="18" r="18" fill="url(#brBall)" />
        <g fill="none" stroke="rgba(40,22,10,.82)" strokeWidth="1.6">
          <path d="M18 0V36M0 18H36" />
          <ellipse cx="-4.7" cy="18" rx="15.5" ry="25.2" />
          <ellipse cx="40.7" cy="18" rx="15.5" ry="25.2" />
        </g>
      </g>
    </svg>
  );
}

// Rating dial for the detail panel. Deliberately monochrome — the detail panel
// carries no accent orange (see the handoff).
function RatingDial({ value, count }) {
  const r = 24, circ = 2 * Math.PI * r;
  const off = circ * (1 - (value || 0) / 5);
  return (
    <div className="dial" title={`${value ?? 'No'} average · ${count} reviews`}>
      <svg viewBox="0 0 52 52" width="52" height="52" aria-hidden="true">
        <circle cx="26" cy="26" r={r} className="dial__track" />
        <circle cx="26" cy="26" r={r} className="dial__arc" strokeDasharray={circ} strokeDashoffset={off}
          transform="rotate(-90 26 26)" />
      </svg>
      <div className="dial__c">
        <b>{value ?? 'New'}</b>
        <span>{count} REV</span>
      </div>
    </div>
  );
}

const SYDNEY_CENTER = { lat: -33.8688, lng: 151.2093 };
const SYDNEY_BOUNDS = { north: -33.3, south: -34.4, east: 151.7, west: 150.4 };
const GMAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';

const TAG_OPTIONS = [
  'Popular', 'New court', 'Lights', 'Free', 'Indoor',
  'Great view', 'Good for practice', 'Competitive', 'Easy parking', 'Smooth surface',
];

// Day: warm, low-saturation parchment map so the custom markers read clearly.
const MAP_STYLE_DAY = [
  { elementType: 'geometry', stylers: [{ color: '#E9E3D8' }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8A7F72' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#F1ECE3' }] },
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#D5CCBC' }] },
  { featureType: 'administrative.land_parcel', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#5C554B' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#DFE1D4' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#F3EFE6' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#E5DDCD' }] },
  { featureType: 'road', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#EFE7D8' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#E0D5C0' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#DCE0DA' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#A89C8C' }] },
];

// Night: the same map, inverted into warm charcoal rather than blue-black.
const MAP_STYLE_NIGHT = [
  { elementType: 'geometry', stylers: [{ color: '#17140F' }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8E8474' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#100E0A' }] },
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#332C22' }] },
  { featureType: 'administrative.land_parcel', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#B3AA9B' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#1B2018' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#262119' }] },
  { featureType: 'road', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#332C22' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0E0C09' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#6E6557' }] },
];

let _loaderPromise = null;
function loadGoogle() {
  if (!GMAPS_KEY) return Promise.reject(new Error('NO_KEY'));
  if (!_loaderPromise) {
    _loaderPromise = new Loader({ apiKey: GMAPS_KEY, version: 'weekly', libraries: ['places'] }).load();
  }
  return _loaderPromise;
}

async function geocodeAddress(address) {
  const google = await loadGoogle();
  const geocoder = new google.maps.Geocoder();
  const { results } = await geocoder.geocode({ address, bounds: SYDNEY_BOUNDS, region: 'AU' });
  if (!results?.length) throw new Error('Address not found');
  const loc = results[0].geometry.location;
  return { lat: loc.lat(), lng: loc.lng(), formatted: results[0].formatted_address };
}

// ---- Google Places (Autocomplete) ----
let _autoSvc = null, _placesSvc = null, _placesToken = null;
async function ensurePlaces() {
  const google = await loadGoogle();
  if (!_autoSvc) _autoSvc = new google.maps.places.AutocompleteService();
  if (!_placesSvc) _placesSvc = new google.maps.places.PlacesService(document.createElement('div'));
  if (!_placesToken) _placesToken = new google.maps.places.AutocompleteSessionToken();
  return google;
}
async function placePredictions(input) {
  const google = await ensurePlaces();
  const bounds = new google.maps.LatLngBounds(
    { lat: SYDNEY_BOUNDS.south, lng: SYDNEY_BOUNDS.west },
    { lat: SYDNEY_BOUNDS.north, lng: SYDNEY_BOUNDS.east }
  );
  return new Promise((resolve) => {
    _autoSvc.getPlacePredictions(
      { input, bounds, componentRestrictions: { country: 'au' }, sessionToken: _placesToken },
      (preds, status) => resolve(status === 'OK' && preds ? preds : [])
    );
  });
}
async function placeDetails(placeId) {
  await ensurePlaces();
  return new Promise((resolve, reject) => {
    _placesSvc.getDetails(
      { placeId, fields: ['name', 'formatted_address', 'geometry'], sessionToken: _placesToken },
      (place, status) => {
        _placesToken = null; // close the billing session after a details lookup
        if (status === 'OK' && place?.geometry) {
          resolve({
            name: place.name || '',
            address: place.formatted_address || '',
            lat: place.geometry.location.lat(),
            lng: place.geometry.location.lng(),
          });
        } else reject(new Error('Could not load that place'));
      }
    );
  });
}

function haversineKm(a, b) {
  const R = 6371, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}
const fmtDist = (km) => (km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`);

// Court markers, per the handoff: 14px dot — outdoor is bone with an orange ring,
// indoor is solid teal, selected turns solid orange inside a translucent halo.
function markerIcon(google, indoor, active) {
  const ORANGE = '#E1571F', TEAL = '#2C7A72', BONE = '#F6F2EA';
  const ring = active ? ORANGE : indoor ? TEAL : ORANGE;
  const fill = active ? ORANGE : indoor ? TEAL : BONE;
  const halo = active
    ? `<circle cx="20" cy="20" r="13" fill="${ORANGE}" fill-opacity="0.16"/>`
    : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">
    ${halo}
    <circle cx="20" cy="22" r="7" fill="rgba(32,28,23,0.24)"/>
    <circle cx="20" cy="20" r="7" fill="${fill}" stroke="${ring}" stroke-width="2"/>
  </svg>`;
  return {
    url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
    scaledSize: new google.maps.Size(40, 40),
    anchor: new google.maps.Point(20, 20),
  };
}

function userIcon(google) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">
    <circle cx="20" cy="20" r="13" fill="#2C7A72" fill-opacity="0.16"/>
    <circle cx="20" cy="20" r="6" fill="#2C7A72" stroke="#F6F2EA" stroke-width="2.5"/>
  </svg>`;
  return {
    url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
    scaledSize: new google.maps.Size(40, 40),
    anchor: new google.maps.Point(20, 20),
  };
}

// The selected marker's ping ring + floating name chip live in an HTML overlay so
// they can use real CSS animation (an SVG marker icon can't).
function makeHaloOverlay(google) {
  class Halo extends google.maps.OverlayView {
    constructor() {
      super();
      this.el = document.createElement('div');
      this.el.className = 'mk-halo';
      this.el.innerHTML = '<span class="mk-halo__ping"></span><span class="mk-halo__label"></span>';
      this.label = this.el.querySelector('.mk-halo__label');
      this.pos = null;
    }
    onAdd() { this.getPanes().floatPane.appendChild(this.el); }
    onRemove() { this.el.remove(); }
    draw() {
      const proj = this.getProjection();
      if (!proj || !this.pos) { this.el.style.display = 'none'; return; }
      const p = proj.fromLatLngToDivPixel(new google.maps.LatLng(this.pos.lat, this.pos.lng));
      this.el.style.display = '';
      this.el.style.left = `${p.x}px`;
      this.el.style.top = `${p.y}px`;
    }
    show(pos, name) { this.pos = pos; this.label.textContent = name; this.draw(); }
    hide() { this.pos = null; this.draw(); }
  }
  return new Halo();
}

// ---------- Google Map ----------
function GoogleMap({ courts, selectedId, onSelectCourt, addMode, onPick, flyTarget, userLoc, theme, ctl }) {
  const divRef = useRef(null);
  const mapRef = useRef(null);
  const googleRef = useRef(null);
  const markersRef = useRef(new Map());
  const clustererRef = useRef(null);
  const userMarkerRef = useRef(null);
  const haloRef = useRef(null);
  const addModeRef = useRef(addMode);
  const onPickRef = useRef(onPick);
  const onSelectRef = useRef(onSelectCourt);
  const [status, setStatus] = useState(GMAPS_KEY ? 'loading' : 'nokey');

  useEffect(() => { addModeRef.current = addMode; }, [addMode]);
  useEffect(() => { onPickRef.current = onPick; }, [onPick]);
  useEffect(() => { onSelectRef.current = onSelectCourt; }, [onSelectCourt]);

  useEffect(() => {
    let cancelled = false;
    loadGoogle()
      .then((google) => {
        if (cancelled) return;
        googleRef.current = google;
        const map = new google.maps.Map(divRef.current, {
          center: SYDNEY_CENTER,
          zoom: 12,
          disableDefaultUI: true,
          clickableIcons: false,
          styles: theme === 'night' ? MAP_STYLE_NIGHT : MAP_STYLE_DAY,
          backgroundColor: theme === 'night' ? '#17140F' : '#E9E3D8',
          gestureHandling: 'greedy',
        });
        map.addListener('click', (e) => {
          if (addModeRef.current) onPickRef.current({ lat: e.latLng.lat(), lng: e.latLng.lng() });
        });
        mapRef.current = map;
        clustererRef.current = new MarkerClusterer({ map });
        haloRef.current = makeHaloOverlay(google);
        haloRef.current.setMap(map);
        if (ctl) {
          ctl.current = {
            zoomIn: () => map.setZoom((map.getZoom() || 12) + 1),
            zoomOut: () => map.setZoom((map.getZoom() || 12) - 1),
          };
        }
        setStatus('ready');
      })
      .catch((err) => setStatus(err.message === 'NO_KEY' ? 'nokey' : 'error'));
    return () => { cancelled = true; };
  }, []); // eslint-disable-line

  // restyle map when the theme changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setOptions({
      styles: theme === 'night' ? MAP_STYLE_NIGHT : MAP_STYLE_DAY,
      backgroundColor: theme === 'night' ? '#17140F' : '#E9E3D8',
    });
  }, [theme, status]);

  // sync court markers (managed by the clusterer) + the selection ping halo
  useEffect(() => {
    const google = googleRef.current, clusterer = clustererRef.current;
    if (!google || !clusterer) return;
    const seen = new Set();
    for (const c of courts) {
      seen.add(c.id);
      const active = c.id === selectedId;
      let m = markersRef.current.get(c.id);
      if (!m) {
        m = new google.maps.Marker({ position: { lat: c.lat, lng: c.lng } });
        m.addListener('click', () => onSelectRef.current(c));
        markersRef.current.set(c.id, m);
      }
      m.setPosition({ lat: c.lat, lng: c.lng });
      m.setIcon(markerIcon(google, c.indoor, active));
      m.setZIndex(active ? 999 : 1);
      m.setTitle(c.name + (c.avgRating ? ` · ★${c.avgRating}` : ''));
    }
    for (const [id, m] of markersRef.current) {
      if (!seen.has(id)) { m.setMap(null); markersRef.current.delete(id); }
    }
    clusterer.clearMarkers();
    clusterer.addMarkers(Array.from(markersRef.current.values()));
    const halo = haloRef.current;
    if (!halo) return;
    const sel = courts.find((c) => c.id === selectedId);
    if (sel) halo.show({ lat: sel.lat, lng: sel.lng }, sel.name);
    else halo.hide();
  }, [courts, selectedId, status, theme]);

  // user-location marker
  useEffect(() => {
    const google = googleRef.current, map = mapRef.current;
    if (!google || !map) return;
    if (!userLoc) {
      if (userMarkerRef.current) { userMarkerRef.current.setMap(null); userMarkerRef.current = null; }
      return;
    }
    if (!userMarkerRef.current) {
      userMarkerRef.current = new google.maps.Marker({ map, title: 'My location', zIndex: 500 });
    }
    userMarkerRef.current.setIcon(userIcon(google));
    userMarkerRef.current.setPosition(userLoc);
  }, [userLoc, status]);

  // fly to target
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !flyTarget) return;
    map.panTo({ lat: flyTarget.lat, lng: flyTarget.lng });
    if (map.getZoom() < 15) map.setZoom(15);
  }, [flyTarget]);

  if (status === 'nokey' || status === 'error') {
    return (
      <div className="map map--fallback">
        <div className="map-fallback__card">
          <h2>Map not connected</h2>
          {status === 'nokey' ? (
            <>
              <p>A Google Maps API key is required to show the Sydney map.</p>
              <ol>
                <li>Enable <b>Maps JavaScript API</b> and <b>Places API</b> in Google Cloud</li>
                <li>Create an API key</li>
                <li>Add it to <code>.env</code>:<br /><code>VITE_GOOGLE_MAPS_API_KEY=your_key</code></li>
                <li>Restart the dev server</li>
              </ol>
              <p className="muted">The court index and every other feature still work on the left.</p>
            </>
          ) : (
            <p>Google Maps failed to load. Check that the API key is valid and that the required APIs and billing are enabled.</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      <div ref={divRef} className="map" />
      {status === 'loading' && <div className="map-loading">Loading map…</div>}
    </>
  );
}

// ---------- small UI helpers ----------
function Stars({ value = 0, size = 16, onChange }) {
  const [hover, setHover] = useState(0);
  const interactive = !!onChange;
  return (
    <span className={'stars' + (interactive ? ' stars--pick' : '')} style={{ fontSize: size }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          className={'star ' + ((hover || value) >= n ? 'on' : '')}
          style={{ cursor: interactive ? 'pointer' : 'default' }}
          onMouseEnter={() => interactive && setHover(n)}
          onMouseLeave={() => interactive && setHover(0)}
          onClick={() => interactive && onChange(n)}
        >★</span>
      ))}
    </span>
  );
}

function Toast({ toast }) {
  if (!toast) return null;
  return <div className={'toast toast--' + toast.type}>{toast.msg}</div>;
}

// ---------- Guest nickname modal ----------
function GuestNameModal({ initial, onClose, onSave }) {
  const [name, setName] = useState(initial || '');
  function submit(e) {
    e.preventDefault();
    const v = name.trim();
    if (v.length < 2) return;
    onSave(v.slice(0, 40));
  }
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal auth" onClick={(e) => e.stopPropagation()}>
        <button className="modal__x" onClick={onClose}>×</button>
        <h2 className="modal__title">Pick a nickname</h2>
        <p className="muted" style={{ margin: '0 0 12px' }}>
          No account needed — just a name to show on the courts and reviews you add. It’s saved on this device for next time.
        </p>
        <form className="form" onSubmit={submit}>
          <label>Nickname
            <input value={name} onChange={(e) => setName(e.target.value)} autoFocus
              placeholder="e.g. CourtHunter" maxLength={40} />
          </label>
          <button className="btn btn--primary" disabled={name.trim().length < 2}>Continue</button>
        </form>
      </div>
    </div>
  );
}

// ---------- Auth modal ----------
function AuthModal({ onClose, onAuthed, notify }) {
  const [mode, setMode] = useState('login'); // login | register | verify | forgot | reset
  const [form, setForm] = useState({ email: '', username: '', password: '', code: '' });
  const [busy, setBusy] = useState(false);
  const [devCode, setDevCode] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const titles = { login: 'Log in', register: 'Sign up', verify: 'Email verification', forgot: 'Forgot password', reset: 'Reset password' };

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === 'login') {
        const { token, user } = await api.login({ email: form.email, password: form.password });
        setSession(token, user); onAuthed(user); notify('success', `Welcome back, ${user.username}`); onClose();
      } else if (mode === 'register') {
        const r = await api.register(form);
        setDevCode(r.devCode || null); notify('success', 'Verification code sent, please check your email'); setMode('verify');
      } else if (mode === 'verify') {
        const { token, user } = await api.verify({ email: form.email, code: form.code });
        setSession(token, user); onAuthed(user); notify('success', 'Verified — account activated'); onClose();
      } else if (mode === 'forgot') {
        const r = await api.forgot({ email: form.email });
        setDevCode(r.devCode || null); notify('success', 'If that email is registered, a reset code has been sent'); setMode('reset');
      } else if (mode === 'reset') {
        const { token, user } = await api.reset({ email: form.email, code: form.code, password: form.password });
        setSession(token, user); onAuthed(user); notify('success', 'Password reset and logged in'); onClose();
      }
    } catch (err) {
      if (err.data?.needVerify) { setMode('verify'); notify('error', 'Email not verified, please enter the code'); }
      else notify('error', err.message);
    } finally { setBusy(false); }
  }

  async function resend() {
    try {
      const r = mode === 'reset' ? await api.forgot({ email: form.email }) : await api.resend({ email: form.email });
      setDevCode(r.devCode || null); notify('success', 'Verification code resent');
    } catch (err) { notify('error', err.message); }
  }

  const submitLabel = busy ? 'Working…'
    : mode === 'login' ? 'Log in'
    : mode === 'register' ? 'Send code'
    : mode === 'verify' ? 'Verify'
    : mode === 'forgot' ? 'Send reset code'
    : 'Reset password';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal auth" onClick={(e) => e.stopPropagation()}>
        <button className="modal__x" onClick={onClose}>×</button>
        <h2 className="modal__title">{titles[mode]}</h2>

        <form onSubmit={submit} className="form">
          <label>Email
            <input type="email" value={form.email} onChange={set('email')} required
              placeholder="you@example.com" disabled={mode === 'verify' || mode === 'reset'} />
          </label>

          {mode === 'register' && (
            <label>Username
              <input value={form.username} onChange={set('username')} required placeholder="Your handle" />
            </label>
          )}

          {(mode === 'login' || mode === 'register' || mode === 'reset') && (
            <label>{mode === 'reset' ? 'New password' : 'Password'}
              <input type="password" value={form.password} onChange={set('password')} required placeholder="At least 6 characters" />
            </label>
          )}

          {(mode === 'verify' || mode === 'reset') && (
            <>
              <label>6-digit code
                <input value={form.code} onChange={set('code')} required inputMode="numeric" maxLength={6} placeholder="● ● ● ● ● ●" />
              </label>
              {devCode && <p className="dev-hint">Dev-mode code: <b>{devCode}</b></p>}
              <button type="button" className="linkbtn" onClick={resend}>Resend code</button>
            </>
          )}

          <button className="btn btn--primary" disabled={busy}>{submitLabel}</button>
        </form>

        <div className="auth__switch">
          {mode === 'login' && (
            <>
              <div>No account? <button className="linkbtn" onClick={() => setMode('register')}>Sign up</button></div>
              <div><button className="linkbtn" onClick={() => setMode('forgot')}>Forgot password?</button></div>
            </>
          )}
          {(mode === 'register' || mode === 'forgot') && (
            <>Already have an account? <button className="linkbtn" onClick={() => setMode('login')}>Log in</button></>
          )}
          {(mode === 'verify' || mode === 'reset') && (
            <button className="linkbtn" onClick={() => setMode('login')}>Back to login</button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- Place search (Google Places Autocomplete) ----------
function PlaceSearch({ onPick, notify }) {
  const [q, setQ] = useState('');
  const [preds, setPreds] = useState([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const tRef = useRef();

  function onChange(e) {
    const v = e.target.value;
    setQ(v);
    clearTimeout(tRef.current);
    if (v.trim().length < 3) { setPreds([]); setOpen(false); return; }
    tRef.current = setTimeout(async () => {
      try {
        const p = await placePredictions(v);
        setPreds(p); setOpen(true);
      } catch (err) {
        notify('error', err.message === 'NO_KEY' ? 'Map key not configured' : 'Place search failed');
      }
    }, 250);
  }
  async function choose(pred) {
    setOpen(false); setQ(pred.description); setBusy(true);
    try { onPick(await placeDetails(pred.place_id)); }
    catch (err) { notify('error', err.message); }
    finally { setBusy(false); }
  }
  return (
    <div className="placesearch">
      <input value={q} onChange={onChange} onFocus={() => preds.length && setOpen(true)}
        placeholder="Search a place on Google Maps…" autoComplete="off" />
      {busy && <span className="placesearch__busy">…</span>}
      {open && preds.length > 0 && (
        <ul className="placesearch__list">
          {preds.map((p) => (
            <li key={p.place_id} onMouseDown={() => choose(p)}>
              <b>{p.structured_formatting?.main_text || p.description}</b>
              <span>{p.structured_formatting?.secondary_text || ''}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------- Court form modal (add + edit) ----------
function CourtFormModal({ initial, pos, onClose, onSaved, onPickOnMap, notify }) {
  const editing = !!initial;
  const [form, setForm] = useState({
    name: initial?.name || '',
    description: initial?.description || '',
    address: initial?.address || '',
    surface: initial?.surface || 'Hard court',
    hoops: initial?.hoops ?? 2,
    indoor: initial?.indoor || false,
    lighting: initial?.lighting || false,
    free: initial?.free ?? true,
    water: initial?.water || false,
    toilets: initial?.toilets || false,
    parking: initial?.parking || false,
    shade: initial?.shade || false,
    fenced: initial?.fenced || false,
  });
  const [coords, setCoords] = useState(
    editing ? { lat: initial.lat, lng: initial.lng } : pos
  );
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  function handlePlace(place) {
    setForm((f) => ({ ...f, name: f.name || place.name, address: place.address || f.address }));
    setCoords({ lat: place.lat, lng: place.lng });
    notify('success', 'Location set from Google Maps');
  }

  async function submit(e) {
    e.preventDefault();
    if (!coords) return notify('error', 'Pick a point on the map or locate by address');
    setBusy(true);
    try {
      const payload = { ...form, hoops: Number(form.hoops), lat: coords.lat, lng: coords.lng };
      const { court } = editing
        ? await api.updateCourt(initial.id, payload)
        : await api.addCourt(payload);
      notify('success', editing ? 'Court updated' : 'Court added');
      onSaved(court);
      onClose();
    } catch (err) { notify('error', err.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal__x" onClick={onClose}>×</button>
        <h2 className="modal__title">{editing ? 'Edit court' : 'Mark a new court'}</h2>

        <label className="search-label">Find the spot</label>
        <PlaceSearch onPick={handlePlace} notify={notify} />
        <div className="coords-row">
          <span className="coords">{coords ? `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}` : 'NO LOCATION YET'}</span>
          {onPickOnMap && (
            <button type="button" className="linkbtn" onClick={onPickOnMap}>or drop a pin on the map</button>
          )}
        </div>

        <form onSubmit={submit} className="form">
          <label>Name<input value={form.name} onChange={(e) => set('name', e.target.value)} required placeholder="e.g. Victoria Park Courts" /></label>
          <label>Address<input value={form.address} onChange={(e) => set('address', e.target.value)} placeholder="Street / park / postcode" /></label>
          <label>Description<textarea value={form.description} onChange={(e) => set('description', e.target.value)} rows={3} placeholder="Vibe, crowd, best times to play…" /></label>
          <div className="form-row">
            <label>Hoops<input type="number" min={1} max={20} value={form.hoops} onChange={(e) => set('hoops', e.target.value)} /></label>
            <label>Surface<input value={form.surface} onChange={(e) => set('surface', e.target.value)} placeholder="Hard court / hardwood" /></label>
          </div>
          <div className="checks">
            <label className="chk"><input type="checkbox" checked={form.indoor} onChange={(e) => set('indoor', e.target.checked)} />Indoor</label>
            <label className="chk"><input type="checkbox" checked={form.lighting} onChange={(e) => set('lighting', e.target.checked)} />Lights</label>
            <label className="chk"><input type="checkbox" checked={form.free} onChange={(e) => set('free', e.target.checked)} />Free</label>
          </div>
          <label>Amenities</label>
          <div className="checks">
            <label className="chk"><input type="checkbox" checked={form.water} onChange={(e) => set('water', e.target.checked)} />Water</label>
            <label className="chk"><input type="checkbox" checked={form.toilets} onChange={(e) => set('toilets', e.target.checked)} />Toilets</label>
            <label className="chk"><input type="checkbox" checked={form.parking} onChange={(e) => set('parking', e.target.checked)} />Parking</label>
            <label className="chk"><input type="checkbox" checked={form.shade} onChange={(e) => set('shade', e.target.checked)} />Shade</label>
            <label className="chk"><input type="checkbox" checked={form.fenced} onChange={(e) => set('fenced', e.target.checked)} />Fenced</label>
          </div>
          <button className="btn btn--primary" disabled={busy}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Save court'}</button>
        </form>
      </div>
    </div>
  );
}

// ---------- Court detail panel ----------
const REPORT_TYPES = [
  { v: 'broken_hoop', label: 'Broken hoop' },
  { v: 'locked', label: 'Locked / no access' },
  { v: 'surface', label: 'Bad surface' },
  { v: 'lighting', label: 'Lights out' },
  { v: 'other', label: 'Other' },
];

const AMENITIES = [
  ['water', 'Water'], ['toilets', 'Toilets'], ['parking', 'Parking'],
  ['shade', 'Shade'], ['fenced', 'Fenced'],
];

function DetailBody({ courtId, user, onClose, onChanged, onEdit, onDeleted, onOpenProfile, requireLogin, requireIdentity, notify }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [review, setReview] = useState({ rating: 0, comment: '', tags: [] });
  const [hasMine, setHasMine] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lightbox, setLightbox] = useState(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [report, setReport] = useState({ type: 'broken_hoop', note: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.court(courtId);
      setData(d);
      const mine = d.reviews.find((r) => user && r.user_id === user.id);
      if (mine) { setReview({ rating: mine.rating, comment: mine.comment, tags: mine.tags }); setHasMine(true); }
      else { setReview({ rating: 0, comment: '', tags: [] }); setHasMine(false); }
    } catch (err) { notify('error', err.message); }
    finally { setLoading(false); }
  }, [courtId, user, notify]);

  useEffect(() => { load(); }, [load]);

  function toggleTag(t) {
    setReview((r) => ({ ...r, tags: r.tags.includes(t) ? r.tags.filter((x) => x !== t) : [...r.tags, t] }));
  }

  async function doSubmitReview() {
    if (!review.rating) return notify('error', 'Please choose a rating first');
    setBusy(true);
    try {
      await api.addReview(courtId, review);
      boom();
      notify('success', 'Review submitted'); await load(); onChanged();
    } catch (err) { notify('error', err.message); }
    finally { setBusy(false); }
  }
  function submitReview(e) {
    e.preventDefault();
    requireIdentity(doSubmitReview); // logged in OR guest nickname
  }

  async function deleteMyReview() {
    if (!window.confirm('Delete your review of this court?')) return;
    try { await api.deleteReview(courtId); notify('success', 'Review deleted'); await load(); onChanged(); }
    catch (err) { notify('error', err.message); }
  }

  async function uploadPhoto(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!user) return requireLogin();
    try { await api.uploadPhoto(courtId, file); notify('success', 'Photo uploaded'); await load(); }
    catch (err) { notify('error', err.message); }
    finally { e.target.value = ''; }
  }

  async function deletePhoto(photoId) {
    if (!window.confirm('Delete this photo?')) return;
    try { await api.deletePhoto(courtId, photoId); notify('success', 'Photo deleted'); await load(); }
    catch (err) { notify('error', err.message); }
  }

  async function deleteCourt() {
    if (!window.confirm(`Delete court "${c.name}"? This cannot be undone.`)) return;
    try { await api.deleteCourt(courtId); notify('success', 'Court deleted'); onDeleted(); }
    catch (err) { notify('error', err.message); }
  }

  async function submitReport(e) {
    e.preventDefault();
    if (!user) return requireLogin();
    try {
      await api.reportCourt(courtId, report);
      notify('success', 'Thanks — report submitted');
      setReportOpen(false); setReport({ type: 'broken_hoop', note: '' });
      await load();
    } catch (err) { notify('error', err.message); }
  }

  const c = data?.court;
  const isOwner = user && c && c.created_by === user.id;
  const canDeletePhoto = (p) => user && (p.user_id === user.id || isOwner);

  if (loading || !c) {
    return (
      <div className="detail__body">
        <div className="detail__top">
          <span className="tag-neutral">Court</span>
          <button className="detail__x" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="skel skel--title" />
        <div className="skel skel--row" />
        <div className="skel skel--row" />
        <div className="skel skel--block" />
      </div>
    );
  }

  return (
    <div className="detail__body">
      <div className="detail__top">
        <span className="tag-neutral">{c.indoor ? 'Indoor' : 'Outdoor'}</span>
        <button className="detail__x" onClick={onClose} aria-label="Close">×</button>
      </div>

      <h1 className="detail__title">{c.name}</h1>

      <div className="detail__id">
        <RatingDial value={c.avgRating} count={c.reviewCount} />
        <div className="detail__idmeta">
          {c.address && <div className="detail__addr"><span className="dotglyph">●</span>{c.address}</div>}
          <div className="detail__acts">
            <a className="ghostbtn" target="_blank" rel="noreferrer"
              href={`https://www.google.com/maps/dir/?api=1&destination=${c.lat},${c.lng}`}>↗ Directions</a>
            {isOwner && <button className="ghostbtn" onClick={() => onEdit(c)}>Edit</button>}
            {isOwner && <button className="ghostbtn ghostbtn--danger" onClick={deleteCourt}>Delete</button>}
          </div>
        </div>
      </div>

      {c.description && <p className="detail__desc">{c.description}</p>}

      <div className="statgrid">
        <div><span>Hoops</span><b>{c.hoops ?? '—'}</b></div>
        <div><span>Surface</span><b>{c.surface || '—'}</b></div>
        <div><span>Lights</span><b>{c.lighting ? 'Yes' : 'No'}</b></div>
        <div><span>Cost</span><b>{c.free ? 'Free' : 'Paid'}</b></div>
      </div>

      {AMENITIES.some(([k]) => c[k]) && (
        <div className="chiprow">
          {AMENITIES.filter(([k]) => c[k]).map(([k, label]) => (
            <span key={k} className="chip-neutral">{label}</span>
          ))}
        </div>
      )}

      {c.topTags?.length > 0 && (
        <div className="chiprow">{c.topTags.map((t) => <span key={t} className="chip-mono">#{t}</span>)}</div>
      )}

      {/* Active problem reports */}
      <div className="section-h">
        <h3>Issues ({data.reports?.length || 0})</h3>
        <button className="linkbtn" onClick={() => (user ? setReportOpen((v) => !v) : requireLogin())}>
          {reportOpen ? 'Cancel' : '⚠ Report a problem'}
        </button>
      </div>
      {reportOpen && (
        <form className="report-form" onSubmit={submitReport}>
          <select value={report.type} onChange={(e) => setReport((r) => ({ ...r, type: e.target.value }))}>
            {REPORT_TYPES.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
          </select>
          <input placeholder="Optional details…" value={report.note}
            onChange={(e) => setReport((r) => ({ ...r, note: e.target.value }))} />
          <button className="btn btn--ink btn--sm">Submit</button>
        </form>
      )}
      {data.reports?.length > 0 ? (
        <ul className="reports">
          {data.reports.map((r) => (
            <li key={r.id}>⚠ <b>{REPORT_TYPES.find((t) => t.v === r.type)?.label || r.type}</b>
              {r.note ? ` — ${r.note}` : ''} <span className="muted">· {r.username}</span></li>
          ))}
        </ul>
      ) : <p className="emptycard">No reported issues. 👍</p>}

      <div className="section-h">
        <h3>Photos ({data.photos.length})</h3>
        <label className="inkbtn">+ Upload<input type="file" accept="image/*" hidden onChange={uploadPhoto} /></label>
      </div>
      {data.photos.length > 0 ? (
        <div className="photos">
          {data.photos.map((p) => (
            <div key={p.id} className="photo">
              <img src={assetUrl(p.url)} alt="Court" loading="lazy" onClick={() => setLightbox(assetUrl(p.url))} />
              {canDeletePhoto(p) && <button className="photo__del" title="Delete" onClick={() => deletePhoto(p.id)}>×</button>}
            </div>
          ))}
        </div>
      ) : (
        <label className="dropzone">
          <input type="file" accept="image/*" hidden onChange={uploadPhoto} />
          <span className="dropzone__k">Drop court photo</span>
          <span className="dropzone__s">Be the first to upload one</span>
        </label>
      )}

      <div className="section-h">
        <h3>My review</h3>
        {hasMine && <button className="linkbtn linkbtn--danger" onClick={deleteMyReview}>Delete my review</button>}
      </div>
      <form className="review-form" onSubmit={submitReview}>
        <Stars value={review.rating} size={26} onChange={(n) => setReview((r) => ({ ...r, rating: n }))} />
        <div className="tagpick">
          {TAG_OPTIONS.map((t) => (
            <button type="button" key={t} className={'tag-pick ' + (review.tags.includes(t) ? 'on' : '')} onClick={() => toggleTag(t)}>{t}</button>
          ))}
        </div>
        <textarea rows={3} placeholder="Tell others what this court is like…" value={review.comment} onChange={(e) => setReview((r) => ({ ...r, comment: e.target.value }))} />
        <button className="btn btn--ink btn--block" disabled={busy}>{busy ? 'Submitting…' : hasMine ? 'Update review' : 'Submit review'}</button>
      </form>

      <div className="section-h"><h3>All reviews ({data.reviews.length})</h3></div>
      {data.reviews.length > 0 ? (
        <ul className="reviews">
          {data.reviews.map((r) => (
            <li key={r.id} className="review">
              <div className="review__top">
                <b className="userlink" onClick={() => onOpenProfile?.(r.user_id)}>{r.username}{user && r.user_id === user.id ? ' (me)' : ''}</b>
                <Stars value={r.rating} size={13} />
              </div>
              {r.tags?.length > 0 && <div className="review__tags">{r.tags.map((t) => <span key={t}>#{t}</span>)}</div>}
              {r.comment && <p>{r.comment}</p>}
            </li>
          ))}
        </ul>
      ) : <p className="empty-italic">No reviews yet — be the first.</p>}

      {lightbox && (
        <div className="lightbox" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="Court" />
          <button className="lightbox__x" onClick={() => setLightbox(null)}>×</button>
        </div>
      )}
    </div>
  );
}

// ---------- Profile modal ----------
function ProfileModal({ userId, currentUser, onClose, onOpenCourt, notify }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setData(await api.userProfile(userId)); }
    catch (err) { notify('error', err.message); }
  }, [userId, notify]);
  useEffect(() => { load(); }, [load]);

  async function toggleFollow() {
    if (!currentUser) return notify('error', 'Please log in first');
    setBusy(true);
    try {
      if (data.isFollowing) await api.unfollow(userId); else await api.follow(userId);
      await load();
    } catch (err) { notify('error', err.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal__x" onClick={onClose}>×</button>
        {!data ? <div className="detail__loading">Loading…</div> : (
          <>
            <h2 className="modal__title">{data.user.username}</h2>
            {data.badges?.length > 0 && (
              <div className="chiprow">{data.badges.map((b) => <span key={b} className="chip-neutral">{b}</span>)}</div>
            )}
            <div className="profile-stats">
              <div><b>{data.counts.courts}</b><span>Courts</span></div>
              <div><b>{data.counts.reviews}</b><span>Reviews</span></div>
              <div><b>{data.counts.photos}</b><span>Photos</span></div>
              <div><b>{data.counts.followers}</b><span>Followers</span></div>
              <div><b>{data.counts.following}</b><span>Following</span></div>
            </div>
            {!data.isMe && currentUser && (
              <button className={'btn ' + (data.isFollowing ? 'btn--ghost' : 'btn--primary')} disabled={busy} onClick={toggleFollow}>
                {data.isFollowing ? 'Following ✓' : '+ Follow'}
              </button>
            )}
            <div className="section-h"><h3>Courts added ({data.courts.length})</h3></div>
            {data.courts.length > 0 ? (
              <ul className="mini-list">
                {data.courts.map((c) => (
                  <li key={c.id} onClick={() => onOpenCourt?.(c)}>{c.name}</li>
                ))}
              </ul>
            ) : <p className="emptycard">No courts yet.</p>}
            <div className="section-h"><h3>Recent reviews ({data.reviews.length})</h3></div>
            {data.reviews.length > 0 ? (
              <ul className="reviews">
                {data.reviews.slice(0, 10).map((r) => (
                  <li key={r.id} className="review">
                    <div className="review__top"><b>{r.court_name}</b><Stars value={r.rating} size={13} /></div>
                    {r.comment && <p>{r.comment}</p>}
                  </li>
                ))}
              </ul>
            ) : <p className="emptycard">No reviews yet.</p>}
          </>
        )}
      </div>
    </div>
  );
}

// ---------- Leaderboard modal ----------
function LeaderboardModal({ onClose, onOpenProfile, notify }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    api.leaderboard().then((d) => setRows(d.leaderboard || [])).catch((e) => notify('error', e.message));
  }, [notify]);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal__x" onClick={onClose}>×</button>
        <h2 className="modal__title">Top contributors</h2>
        {!rows ? <div className="detail__loading">Loading…</div> : rows.length === 0 ? (
          <p className="emptycard">No contributors yet — be the first to add a court!</p>
        ) : (
          <ol className="leaderboard">
            {rows.map((u, i) => (
              <li key={u.id}>
                <span className="lb-rank">{String(i + 1).padStart(2, '0')}</span>
                <span className="lb-name userlink" onClick={() => onOpenProfile?.(u.id)}>{u.username}</span>
                <span className="lb-meta">{u.courts} courts · {u.reviews} reviews · {u.photos} photos</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

// ---------- Index panel (left) ----------
function IndexPanel({ courts, filters, setFilters, selectedId, onSelect, userLoc, onPeek, expanded }) {
  const set = (k, v) => setFilters((f) => ({ ...f, [k]: v }));
  const list = useMemo(() => {
    let arr = (courts || []).filter((c) => {
      if (filters.q && !(`${c.name} ${c.address}`.toLowerCase().includes(filters.q.toLowerCase()))) return false;
      if (filters.type === 'indoor' && !c.indoor) return false;
      if (filters.type === 'outdoor' && c.indoor) return false;
      if (filters.free && !c.free) return false;
      if (filters.lighting && !c.lighting) return false;
      if (filters.tag && !((c.topTags || []).includes(filters.tag))) return false;
      return true;
    });
    if (userLoc) arr = arr.map((c) => ({ ...c, _dist: haversineKm(userLoc, { lat: c.lat, lng: c.lng }) }));
    if (filters.sort === 'dist' && userLoc) arr.sort((a, b) => a._dist - b._dist);
    else if (filters.sort === 'rating') arr.sort((a, b) => (b.avgRating || 0) - (a.avgRating || 0));
    else if (filters.sort === 'newest') arr.sort((a, b) => b.id - a.id);
    return arr;
  }, [courts, filters, userLoc]);

  // tags present across courts, for quick-filter chips
  const allTags = useMemo(() => {
    const seen = new Set();
    for (const c of courts || []) for (const t of c.topTags || []) seen.add(t);
    return Array.from(seen).slice(0, 6);
  }, [courts]);

  return (
    <aside className={'index' + (expanded ? ' is-open' : '')}>
      <button className="index__grab" onClick={onPeek} aria-label="Expand court list" />

      <div className="index__brand">
        <BallMark />
        <div>
          <div className="wordmark">Ball Radar</div>
          <div className="mono-sub">Sydney basketball court radar</div>
        </div>
      </div>

      <div className="index__controls">
        <div className="searchbox">
          <span className="searchbox__ico" aria-hidden="true">⌕</span>
          <input placeholder="Search courts / address…" value={filters.q} onChange={(e) => set('q', e.target.value)} />
        </div>

        <div className="seg">
          {['all', 'outdoor', 'indoor'].map((t) => (
            <button key={t} className={filters.type === t ? 'on' : ''} onClick={() => set('type', t)}>
              {t === 'all' ? 'All' : t === 'outdoor' ? 'Outdoor' : 'Indoor'}
            </button>
          ))}
        </div>

        <div className="toggles">
          <label className="chk"><input type="checkbox" checked={filters.free} onChange={(e) => set('free', e.target.checked)} /><span className="chk__box" />Free only</label>
          <label className="chk"><input type="checkbox" checked={filters.lighting} onChange={(e) => set('lighting', e.target.checked)} /><span className="chk__box" />Has lights</label>
        </div>

        <div className="sortrow">
          <span className="mono-label">Sort</span>
          <select value={filters.sort} onChange={(e) => set('sort', e.target.value)}>
            <option value="default">Default</option>
            <option value="rating">Top rated</option>
            <option value="newest">Newest</option>
            {userLoc && <option value="dist">Nearest</option>}
          </select>
        </div>

        {allTags.length > 0 && (
          <div className="tagfilter">
            {allTags.map((t) => (
              <button key={t} className={'chip-mono chip-mono--btn ' + (filters.tag === t ? 'on' : '')}
                onClick={() => set('tag', filters.tag === t ? null : t)}>#{t}</button>
            ))}
          </div>
        )}
      </div>

      <div className="index__count">
        <span className="index__count-n">{list.length} / <CountUp value={courts.length} /></span> COURTS
        <span className="rule" />
      </div>

      <ul className="courtlist">
        {list.map((c, i) => (
          <li key={c.id} className={'courtcard ' + (c.id === selectedId ? 'on' : '')}
            style={{ animationDelay: `${Math.min(i, 10) * 32}ms` }}
            onClick={() => onSelect(c)}>
            <div className="courtcard__row">
              <div className="courtcard__name">{c.name}</div>
              <span className={'typetag ' + (c.indoor ? 'typetag--indoor' : 'typetag--outdoor')}>{c.indoor ? 'Indoor' : 'Outdoor'}</span>
            </div>
            <div className="courtcard__meta">
              <span className={'courtcard__rating' + (c.reviewCount ? ' has' : '')}>
                {c.reviewCount ? `${c.avgRating} ★` : 'New'}
              </span>
              <span className="sep">·</span>
              <span>{c.reviewCount === 1 ? '1 review' : `${c.reviewCount} reviews`}</span>
              <span className="grow" />
              {c._dist != null && <span className="badge badge--dist">{fmtDist(c._dist)}</span>}
              {c.lighting && <span className="badge">Lights</span>}
              {c.free && <span className="badge">Free</span>}
            </div>
          </li>
        ))}
        {list.length === 0 && <li className="courtlist__empty">No courts match your filters.</li>}
      </ul>

      <a className="index__foot" href="/about">ⓘ About the developer</a>
    </aside>
  );
}

// ---------- Command palette (⌘K) ----------
function CommandPalette({ courts, onClose, run }) {
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const actions = [
    { id: 'mark', icon: '+', label: 'Mark a court' },
    { id: 'nearby', icon: '◎', label: 'Find courts near me' },
    { id: 'leaders', icon: '▲', label: 'Leaderboard' },
    { id: 'theme', icon: '☾', label: 'Toggle day / night' },
    { id: 'about', icon: 'ⓘ', label: 'About the developer' },
  ];
  const ql = q.trim().toLowerCase();
  const hits = ql
    ? (courts || []).filter((c) => `${c.name} ${c.address}`.toLowerCase().includes(ql)).slice(0, 6)
    : (courts || []).slice(0, 5);
  const items = [
    ...actions.filter((a) => !ql || a.label.toLowerCase().includes(ql)).map((a) => ({ type: 'action', ...a })),
    ...hits.map((c) => ({ type: 'court', id: 'court-' + c.id, label: c.name, sub: c.address, court: c })),
  ];
  useEffect(() => { setIdx(0); }, [q]);

  function onKey(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(i + 1, items.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (items[idx]) run(items[idx]); }
    else if (e.key === 'Escape') { onClose(); }
  }

  return (
    <div className="modal-overlay cmdk-overlay" onClick={onClose}>
      <div className="cmdk" onClick={(e) => e.stopPropagation()}>
        <input autoFocus className="cmdk-input" placeholder="Search courts or jump to…" value={q}
          onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} />
        <ul className="cmdk-list">
          {items.map((it, i) => (
            <li key={it.id} className={'cmdk-item ' + (i === idx ? 'on' : '')}
              onMouseEnter={() => setIdx(i)} onMouseDown={() => run(it)}>
              <span className="cmdk-ico">{it.type === 'court' ? '◍' : it.icon}</span>
              <span className="cmdk-label">{it.label}{it.sub ? <em>{it.sub}</em> : null}</span>
            </li>
          ))}
          {items.length === 0 && <li className="cmdk-empty">No matches</li>}
        </ul>
      </div>
    </div>
  );
}

// ---------- Intro loader ----------
function IntroLoader({ count, fading }) {
  return (
    <div className={'intro' + (fading ? ' is-gone' : '')} aria-hidden="true">
      <div className="intro__radar">
        <span className="intro__ring" />
        <span className="intro__sweep" />
        <span className="intro__core">●</span>
      </div>
      <div className="intro__text">
        <div className="intro__name">Ball Radar</div>
        <div className="mono-sub">Scanning Sydney · {count} courts</div>
      </div>
    </div>
  );
}

// ---------- App ----------
export default function App() {
  const [user, setUser] = useState(getUser());
  const [courts, setCourts] = useState([]);
  const [selected, setSelected] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [flyTarget, setFlyTarget] = useState(null);
  const [filters, setFilters] = useState({ q: '', type: 'all', free: false, lighting: false, sort: 'default', tag: null });
  const [authOpen, setAuthOpen] = useState(false);
  const [addMode, setAddMode] = useState(false);
  const [addPos, setAddPos] = useState(null);
  const [addingCourt, setAddingCourt] = useState(false);
  const [editCourt, setEditCourt] = useState(null);
  const [userLoc, setUserLoc] = useState(null);
  const [toast, setToast] = useState(null);
  const [theme, setTheme] = useState(() => localStorage.getItem('ballradar_theme') || 'day');
  const [profileUserId, setProfileUserId] = useState(null);
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);
  const [guestName, setGuestNameState] = useState(getGuestName());
  const [guestModalOpen, setGuestModalOpen] = useState(false);
  const pendingActionRef = useRef(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false); // mobile: index panel expanded
  const mapCtl = useRef({ zoomIn() {}, zoomOut() {} });

  // intro loader: fades at 1.5s, unmounts at 2.2s (skipped once per session)
  const [intro, setIntro] = useState(
    () => !sessionStorage.getItem('ballradar_splashed') && !reduceMotion()
  );
  const [introFading, setIntroFading] = useState(false);
  useEffect(() => {
    if (!intro) return;
    sessionStorage.setItem('ballradar_splashed', '1');
    const a = setTimeout(() => setIntroFading(true), 1500);
    const b = setTimeout(() => setIntro(false), 2200);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, []); // eslint-disable-line

  // ⌘K / Ctrl+K opens the command palette
  useEffect(() => {
    const h = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPaletteOpen((v) => !v); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  // apply + persist theme
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('ballradar_theme', theme);
  }, [theme]);

  const notify = useCallback((type, msg) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3200);
  }, []);

  // validate stored token on load
  useEffect(() => {
    if (getToken()) {
      api.me().then(({ user }) => setUser((u) => u || user)).catch(() => { clearSession(); setUser(null); });
    }
  }, []);

  const loadCourts = useCallback(async () => {
    try {
      const data = await api.courts();
      setCourts(Array.isArray(data?.courts) ? data.courts : []);
    } catch (err) {
      setCourts([]);
      notify('error', 'Failed to load courts: ' + err.message);
    }
  }, [notify]);

  useEffect(() => { loadCourts(); }, [loadCourts]);

  const selectCourt = useCallback((c) => {
    setSelected(c);
    setDetailOpen(true);
    setFlyTarget({ lat: c.lat, lng: c.lng, _t: Date.now() });
    setSheetOpen(false); // collapse the mobile sheet on selection
  }, []);

  function toggleTheme() {
    const next = theme === 'day' ? 'night' : 'day';
    if (document.startViewTransition) document.startViewTransition(() => setTheme(next));
    else setTheme(next);
  }

  const requireLogin = useCallback(() => { setAuthOpen(true); notify('error', 'Please log in first'); }, [notify]);

  // Run an action if the visitor has an identity (logged in OR a guest nickname);
  // otherwise prompt for a nickname first, then run it.
  const ensureIdentity = useCallback((action) => {
    if (user || getGuestName()) { action(); return; }
    pendingActionRef.current = action;
    setGuestModalOpen(true);
  }, [user]);

  function saveGuestName(name) {
    setGuestName(name); setGuestNameState(name); setGuestModalOpen(false);
    const act = pendingActionRef.current; pendingActionRef.current = null;
    if (act) act();
  }

  const handlePick = useCallback((pos) => {
    ensureIdentity(() => { setAddPos(pos); setAddMode(false); setAddingCourt(true); });
  }, [ensureIdentity]);

  function logout() { clearSession(); setUser(null); notify('success', 'Logged out'); }

  function locateMe() {
    if (!navigator.geolocation) return notify('error', 'Geolocation not supported by your browser');
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const loc = { lat: p.coords.latitude, lng: p.coords.longitude };
        setUserLoc(loc);
        setFlyTarget({ ...loc, _t: Date.now() });
        setFilters((f) => ({ ...f, sort: 'dist' }));
        notify('success', 'Located — sorted by distance');
      },
      () => notify('error', 'Location failed or denied'),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }

  function markCourt() {
    if (addMode) { setAddMode(false); return; }
    ensureIdentity(() => { setAddPos(null); setAddingCourt(true); });
  }

  function runCommand(it) {
    setPaletteOpen(false);
    if (it.type === 'court') { selectCourt(it.court); return; }
    if (it.id === 'mark') ensureIdentity(() => { setAddPos(null); setAddingCourt(true); });
    else if (it.id === 'nearby') locateMe();
    else if (it.id === 'leaders') setLeaderboardOpen(true);
    else if (it.id === 'theme') toggleTheme();
    else if (it.id === 'about') window.location.href = '/about';
  }

  return (
    <div className={'stage' + (addMode ? ' is-picking' : '') + (detailOpen ? ' has-detail' : '')}>
      <GoogleMap
        courts={courts} selectedId={detailOpen ? selected?.id : null} onSelectCourt={selectCourt}
        addMode={addMode} onPick={handlePick} flyTarget={flyTarget} userLoc={userLoc} theme={theme}
        ctl={mapCtl}
      />

      {/* ---- map chrome ---- */}
      <div className="readout">
        <div>{SYDNEY_CENTER.lat.toFixed(4)}°&nbsp;&nbsp;{SYDNEY_CENTER.lng.toFixed(4)}°</div>
        <div className="readout__live">● LIVE · {courts.length} COURTS</div>
      </div>

      <div className="zoomctl">
        <button onClick={() => mapCtl.current.zoomIn()} aria-label="Zoom in">+</button>
        <button onClick={() => mapCtl.current.zoomOut()} aria-label="Zoom out">−</button>
      </div>

      {/* ---- top command bar ---- */}
      <div className="cmdbar">
        <div className="cmdbar__left">
          <button className="pill pill--icon cmdbar__menu" aria-label="Court list" onClick={() => setSheetOpen((v) => !v)}>☰</button>
          <button className={'pill ' + (addMode ? 'is-armed' : '')} onClick={markCourt} aria-label="Mark court">
            <span className="pill__plus">+</span>
            <span className="pill__label">{addMode ? 'Click the map · Cancel' : 'Mark court'}</span>
          </button>
          <button className="pill" onClick={locateMe}>Nearby</button>
          <button className="pill cmdbar__wide" onClick={() => setPaletteOpen(true)}>
            Search <kbd>⌘K</kbd>
          </button>
          <button className="pill cmdbar__wide" onClick={() => setLeaderboardOpen(true)}>Leaders</button>
          <button className="pill pill--icon" title="Toggle day / night" onClick={toggleTheme}>
            {theme === 'day' ? '☾' : '☀'}
          </button>
        </div>

        <div className="cmdbar__right">
          {user ? (
            <div className="userchip">
              <span className="userlink" onClick={() => setProfileUserId(user.id)}>{user.username}</span>
              <button className="linkbtn" onClick={logout}>Log out</button>
            </div>
          ) : guestName ? (
            <div className="userchip">
              <span className="userlink" onClick={() => setGuestModalOpen(true)} title="Change nickname">{guestName}</span>
              <button className="linkbtn" onClick={() => setAuthOpen(true)}>Log in</button>
            </div>
          ) : (
            <button className="btn btn--primary" onClick={() => setAuthOpen(true)}>
              Log in<span className="btn__more"> / Sign up</span>
            </button>
          )}
        </div>
      </div>

      <IndexPanel
        courts={courts} filters={filters} setFilters={setFilters}
        selectedId={detailOpen ? selected?.id : null} onSelect={selectCourt} userLoc={userLoc}
        expanded={sheetOpen} onPeek={() => setSheetOpen((v) => !v)}
      />

      {/* Always mounted so it can slide out with its content intact. */}
      <section className={'detail' + (detailOpen ? ' is-open' : '')} aria-hidden={!detailOpen}>
        {selected && (
          <DetailBody
            key={selected.id}
            courtId={selected.id} user={user}
            onClose={() => setDetailOpen(false)}
            onChanged={loadCourts}
            onEdit={(c) => setEditCourt(c)}
            onDeleted={() => { setDetailOpen(false); setSelected(null); loadCourts(); }}
            onOpenProfile={(id) => setProfileUserId(id)}
            requireLogin={requireLogin} requireIdentity={ensureIdentity} notify={notify}
          />
        )}
      </section>

      {addMode && <div className="pick-hint">Click anywhere on the map to mark a new court</div>}

      {authOpen && <AuthModal onClose={() => setAuthOpen(false)} onAuthed={setUser} notify={notify} />}

      {guestModalOpen && (
        <GuestNameModal
          initial={guestName}
          onClose={() => { setGuestModalOpen(false); pendingActionRef.current = null; }}
          onSave={saveGuestName}
        />
      )}

      {paletteOpen && (
        <CommandPalette courts={courts} onClose={() => setPaletteOpen(false)} run={runCommand} />
      )}

      {sheetOpen && <div className="sheet-backdrop" onClick={() => setSheetOpen(false)} />}

      {intro && <IntroLoader count={courts.length || 317} fading={introFading} />}

      {addingCourt && (
        <CourtFormModal
          key={addPos ? `${addPos.lat},${addPos.lng}` : 'new'}
          pos={addPos}
          onClose={() => { setAddingCourt(false); setAddPos(null); }}
          onSaved={(court) => { boom(); loadCourts(); selectCourt(court); }}
          onPickOnMap={() => { setAddingCourt(false); setAddMode(true); }}
          notify={notify}
        />
      )}

      {editCourt && (
        <CourtFormModal
          initial={editCourt} onClose={() => setEditCourt(null)}
          onSaved={(court) => { loadCourts(); setSelected(court); setFlyTarget({ lat: court.lat, lng: court.lng, _t: Date.now() }); }}
          notify={notify}
        />
      )}

      {profileUserId && (
        <ProfileModal
          userId={profileUserId} currentUser={user}
          onClose={() => setProfileUserId(null)}
          onOpenCourt={(c) => { setProfileUserId(null); selectCourt(c); }}
          notify={notify}
        />
      )}

      {leaderboardOpen && (
        <LeaderboardModal
          onClose={() => setLeaderboardOpen(false)}
          onOpenProfile={(id) => { setLeaderboardOpen(false); setProfileUserId(id); }}
          notify={notify}
        />
      )}

      <Toast toast={toast} />
    </div>
  );
}
