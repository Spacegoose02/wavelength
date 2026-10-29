import { skipWebSignIn, useWebHub } from '../lib/webHub';
import { useHub } from '../store/hub';
import { SignedOut } from '../views/HubSettings';

/** Full-screen sign-in when Wavelength is opened in a browser from the Hub and nobody is signed in yet. */
export function WebSignIn() {
  const origin = useWebHub((s) => s.origin);
  const skipped = useWebHub((s) => s.skipped);
  const signedIn = useHub((s) => !!s.token);
  if (!origin || skipped || signedIn) return null;
  return (
    <div className="web-signin">
      <div className="web-signin-card">
        <div className="brand"><span className="brand-mark" />Wavelength</div>
        <SignedOut key={origin} />
        <button className="btn ghost small" onClick={skipWebSignIn}>Continue without signing in</button>
      </div>
    </div>
  );
}
