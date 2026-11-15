import { useState } from "react";
import type { FormEvent } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { useSiteLogo } from "../hooks/useSiteLogo";
import { getAppBasePath } from "../utils/basePath.ts";
import { DotLoader } from "../components/DotLoader";
import { rememberShareImport } from "../utils/shareLink.ts";
import { setStoredAuth, asApiError } from "../utils/api/core.ts";
import { invalidateBootstrapCache } from "../utils/appHealth.ts";
import { openPlexPopup, runPlexLogin } from "../utils/plexLogin.ts";

const buildApiUrl = (path: string) => {
  const basePath = getAppBasePath();
  const prefix = basePath === "/" ? "" : basePath.replace(/\/$/, "");
  return `${prefix}${path}`;
};

const Login = () => {
  useDocumentTitle("Sign in");
  const logo = useSiteLogo();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [showLocalForm, setShowLocalForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [startingSso, setStartingSso] = useState(false);
  const [startingPlex, setStartingPlex] = useState(false);
  const { login, bootstrap, refreshAuth } = useAuth();
  const oidcEnabled = !!bootstrap?.oidcEnabled;
  const googleEnabled = !!bootstrap?.googleLoginEnabled;
  const plexEnabled = !!bootstrap?.plexLoginEnabled;
  const hasSsoOption = oidcEnabled || googleEnabled || plexEnabled;
  const localFormVisible = !hasSsoOption || showLocalForm;

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      const result = await login(password, username);

      if (result.ok) {
        setError("");
      } else if (result.status === 429) {
        setError("Too many sign-in attempts. Wait a few minutes, then try again.");
      } else {
        setError("Invalid username or password");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleOidcLogin = () => {
    if (startingSso) return;
    setStartingSso(true);
    rememberShareImport();
    window.location.assign(buildApiUrl("/api/auth/oidc/login"));
  };

  const handleGoogleLogin = () => {
    rememberShareImport();
    window.location.assign(buildApiUrl("/api/auth/google/login"));
  };

  const handlePlexLogin = async () => {
    try {
      const popup = openPlexPopup();
      setStartingPlex(true);
      const result = await runPlexLogin(popup, false);
      if (!result.done || result.linked) throw new Error("Plex did not return a session");
      setStoredAuth({ token: result.token });
      invalidateBootstrapCache();
      if (!(await refreshAuth())) throw new Error("Could not load your account after Plex sign-in");
    } catch (error) {
      const data = asApiError(error)?.response?.data;
      setError(
        typeof data === "object" && data && typeof data.error === "string"
          ? data.error
          : error instanceof Error
            ? error.message
            : "Plex sign-in failed",
      );
    } finally {
      setStartingPlex(false);
    }
  };

  return (
    <main className="login-page">
      <div className="login-card">
        <div className="login-header">
          <img src={logo.src} alt="Aurral" className={`login-logo${logo.className}`} />
          <h1 className="login-title">Sign in</h1>
        </div>

        {hasSsoOption && (
          <div className="login-sso">
            {plexEnabled && (
              <button
                type="button"
                className="btn btn-secondary btn--full login-sso-button"
                onClick={handlePlexLogin}
                disabled={startingPlex}
              >
                {startingPlex ? "Signing in with Plex…" : "Sign in with Plex"}
              </button>
            )}
            {oidcEnabled && (
              <button
                type="button"
                className="btn btn-secondary btn--full login-sso-button"
                onClick={handleOidcLogin}
                disabled={startingSso}
              >
                {startingSso ? <DotLoader size="sm" label={null} /> : null}
                {startingSso ? "Opening SSO…" : "Sign in with SSO"}
              </button>
            )}
            {googleEnabled && (
              <button
                type="button"
                className="btn btn-secondary btn--full login-sso-button"
                onClick={handleGoogleLogin}
              >
                Sign in with Google
              </button>
            )}
            {localFormVisible && (
              <div className="login-divider">
                <span>or</span>
              </div>
            )}
          </div>
        )}

        {localFormVisible ? (
          <form className="login-form" onSubmit={handleSubmit}>
            <div className="login-fields">
              <div className="login-field">
                <label htmlFor="username" className="sr-only">
                  Username
                </label>
                <input
                  id="username"
                  name="username"
                  type="text"
                  required
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  enterKeyHint="next"
                  className="login-input"
                  placeholder="Username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  aria-invalid={error ? "true" : undefined}
                  aria-describedby={error ? "login-error" : undefined}
                />
              </div>
              <div className="login-field">
                <label htmlFor="password" className="sr-only">
                  Password
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  required
                  autoComplete="current-password"
                  enterKeyHint="go"
                  className="login-input"
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  aria-invalid={error ? "true" : undefined}
                  aria-describedby={error ? "login-error" : undefined}
                />
              </div>
            </div>

            {error && (
              <p id="login-error" className="login-error" role="alert">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="btn btn-primary btn--full login-submit"
            >
              {submitting ? <DotLoader size="sm" label={null} /> : null}
              {submitting ? "Signing in…" : "Sign in"}
            </button>
          </form>
        ) : (
          <>
            {error && (
              <p id="login-error" className="login-error" role="alert">
                {error}
              </p>
            )}
            <button
              type="button"
              className="login-local-toggle"
              onClick={() => setShowLocalForm(true)}
            >
              Sign in with a local account instead
            </button>
          </>
        )}
      </div>
    </main>
  );
};

export default Login;
