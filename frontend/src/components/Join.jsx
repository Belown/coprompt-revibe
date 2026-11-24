// Shown when the URL has no ?user=: pick a name and a session (room). Imports nothing from the store,
// so nothing connects before the user is known.
// ponytail: 4 random digits, easy to say aloud; guessable and may land on a session in use. Longer ids if rooms must stay private.
export const newRoom = () => String(Math.floor(Math.random() * 10000)).padStart(4, '0');
const ROOM_OK = s => s.trim().replace(/[^\w-]+/g, '-').slice(0, 64); // the backend accepts [\w-]{1,64}

export default function Join() {
  const q = new URLSearchParams(location.search), invited = q.get('room');
  const submit = e => {
    e.preventDefault();
    const f = new FormData(e.target), user = f.get('user').trim().slice(0, 40), room = ROOM_OK(f.get('room')) || newRoom();
    if (!user) return;
    localStorage.setItem('cp_name', user); // personal, never synced
    q.set('user', user); q.set('room', room);
    location.search = q;
  };
  return <div id="join">
    <form className="dlg" onSubmit={submit}>
      <h3>{invited ? 'Join this CoPrompt session' : 'Start a CoPrompt session'}</h3>
      <p className="muted">Everyone who opens the same session link edits the same notebook, live, from any device.
        The scenario is written for Alice and Bob, but any number of people can join.</p>
      <label>Your name<input name="user" required autoFocus maxLength={40} defaultValue={localStorage.getItem('cp_name') || ''} placeholder="Alice" /></label>
      <label>Session<input name="room" maxLength={64} defaultValue={invited || newRoom()} /></label>
      <div className="btns"><button className="primary">{invited ? 'Join' : 'Start'}</button></div>
    </form>
  </div>;
}
