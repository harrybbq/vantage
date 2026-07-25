import { useState } from 'react';
import Icon from './Icon';
import { useQuery } from '@tanstack/react-query';

async function fetchLastFmTrack(username) {
  const url = `https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks&user=${encodeURIComponent(username)}&api_key=3b03e5843f63e88f5a7b3a2c6b2d1e4f&limit=1&format=json`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  const track = data.recenttracks?.track?.[0];
  if (!track) return null;
  return {
    track: track.name,
    artist: track.artist['#text'] || track.artist.name || '',
    album: track.album?.['#text'] || '',
    artUrl: track.image?.find(i => i.size === 'medium')?.['#text'] || '',
    trackUrl: track.url || '',
    nowPlaying: track['@attr']?.nowplaying === 'true',
  };
}

export default function SpotifyBar({ visible, username, onSetUsername }) {
  const [inputVal, setInputVal] = useState(username);

  const { data: info } = useQuery({
    queryKey: ['lastfm', username],
    queryFn: () => fetchLastFmTrack(username),
    enabled: !!username,
    refetchInterval: 30_000,
    staleTime: 25_000,
    retry: false,
  });

  function handleConnect() {
    const val = inputVal.trim();
    if (!val) return;
    onSetUsername(val);
  }

  return (
    <div id="spotifyBar" className={visible ? 'visible' : ''}>
      <div className="sp-art" id="spArt">
        {info?.artUrl
          ? <img src={info.artUrl} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '4px' }} alt="" onError={e => { e.target.style.display = 'none'; }} />
          : <Icon name="music" size={16} strokeWidth={1.6} />}
      </div>
      <div className="sp-track">
        <div className="sp-track-name">
          {info ? info.track : (username ? 'No recent tracks found' : 'Last.fm not set up')}
        </div>
        <div className="sp-track-sub">
          {info
            ? info.artist + (info.album ? ' · ' + info.album : '')
            : (username ? 'No recent tracks found' : 'Enter your Last.fm username to show recently played tracks')}
        </div>
      </div>
      <div className="sp-right">
        {info?.nowPlaying && (
          <div id="lfmLiveBadge" style={{ display: 'flex', alignItems: 'center', gap: '5px', background: 'rgba(188,30,30,.18)', border: '1px solid rgba(188,30,30,.4)', borderRadius: '100px', padding: '3px 10px 3px 7px', flexShrink: 0 }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#d62828', display: 'inline-block', animation: 'lfmPulse 1.4s ease-in-out infinite' }}></span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: '#e87878', letterSpacing: '1px', textTransform: 'uppercase' }}>Now Playing</span>
          </div>
        )}
        <div className="sp-set-form">
          <input
            id="lfmUsernameInput"
            placeholder="Last.fm username…"
            value={inputVal}
            onChange={e => setInputVal(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleConnect(); }}
            style={{ width: '160px' }}
          />
          <button className="sp-set-btn" onClick={handleConnect}>Connect</button>
        </div>
        {info?.trackUrl && (
          <a
            id="spOpenBtn"
            className="sp-open-btn"
            href={info.trackUrl || `https://www.last.fm/user/${username}`}
            target="_blank"
            rel="noreferrer"
          >
            <span style={{display:'inline-flex',alignItems:'center',gap:4}}>Open on Last.fm <Icon name="external-link" size={11} /></span>
          </a>
        )}
        <span className="sp-spotify-logo" title="Powered by Last.fm" style={{ fontSize: '11px', fontFamily: 'var(--mono)', color: '#d62828', opacity: '.8', letterSpacing: '.5px' }}>last.fm</span>
      </div>
    </div>
  );
}
